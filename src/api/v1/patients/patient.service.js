const Patient = require('./patient.model');
const generatePatientId = require('../../../utils/patientIdGenerator');
const AppError = require('../../../utils/AppError');
const logger = require('../../../utils/logger');
const { ROLES } = require('../../../config/constants');
const { anonymizePatient, anonymizePatients } = require('../../../utils/anonymize');
const auditService = require('../audit-logs/auditLog.service');

const DEFAULT_LIFESTYLE = Object.freeze({
  smoking: false,
  alcohol: false,
  diet: '',
  physical_activity: '',
});

const normalizeLifestyle = (lifestyle = {}) => ({
  ...DEFAULT_LIFESTYLE,
  ...(lifestyle && typeof lifestyle === 'object' ? lifestyle : {}),
});

exports.registerPatient = async (data, actor) => {
  // Duplicate detection: contact_number OR national_id
  const dupFilter = [];
  if (data.contact_number) dupFilter.push({ contact_number: data.contact_number });
  if (data.national_id) dupFilter.push({ national_id: data.national_id });

  if (dupFilter.length) {
    const existing = await Patient.findOne({ $or: dupFilter });
    if (existing) {
      const err = new AppError('Duplicate patient entry detected.', 409);
      err.existing_patient_id = existing.patient_id;
      throw err;
    }
  }

  // generate patient_id and attempt create with retry on duplicate-key collisions
  const maxRetries = 5;
  let attempt = 0;
  let patient;
  while (attempt < maxRetries) {
    attempt += 1;
    const patient_id = await generatePatientId();
    const toCreate = Object.assign({}, data, {
      patient_id,
      created_by: actor?.id,
      lifestyle: normalizeLifestyle(data.lifestyle),
    });
    try {
      patient = await Patient.create(toCreate);
      logger.info({ event: 'PATIENT_CREATED', actor_id: actor?.id, actor_role: actor?.role, ip: actor?.ip, patient_id });
      await auditService.logAuditEvent({
        actor,
        action: 'CREATE_PATIENT',
        entity_type: 'patient',
        entity_id: patient.patient_id,
        entity_name: `${patient.first_name} ${patient.last_name}`.trim(),
        description: 'Patient created.',
        new_value: patient,
      });
      return patient;
    } catch (err) {
      // E11000 duplicate key error from Mongo
      if (err && err.code === 11000 && attempt < maxRetries) {
        // retry with a new ID
        continue;
      }
      throw err;
    }
  }
  throw new AppError('Failed to generate a unique patient_id after multiple attempts.', 500);
};

exports.getPatients = async (query = {}, actor = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.max(1, parseInt(query.limit, 10) || 20);
  const skip = (page - 1) * limit;

  const filter = {};
  // If a patient-role actor requests, restrict to their own record only
  if (actor.role === ROLES.PATIENT && actor.patient_id) {
    filter.patient_id = actor.patient_id;
  }
  if (query.status) filter.status = query.status;
  if (query.search) {
    const q = query.search.trim();
    const parts = q.split(/\s+/).filter(p => p.length > 0);
    
    // If search contains multiple parts (e.g., "Olivia Gonzalez"), match full name
    if (parts.length > 1) {
      const firstName = parts[0];
      const lastName = parts.slice(1).join(' ');
      filter.$or = [
        // Match full name (first + last)
        { first_name: new RegExp(firstName, 'i'), last_name: new RegExp(lastName, 'i') },
        // Also try reverse (in case user entered last name first)
        { first_name: new RegExp(lastName, 'i'), last_name: new RegExp(firstName, 'i') },
        // Keep original logic for partial matches
        { first_name: new RegExp(q, 'i') },
        { last_name: new RegExp(q, 'i') },
        { contact_number: new RegExp(q, 'i') },
      ];
    } else {
      // Single word search - use original logic
      filter.$or = [
        { first_name: new RegExp(q, 'i') },
        { last_name: new RegExp(q, 'i') },
        { contact_number: new RegExp(q, 'i') },
      ];
    }
  }

  const [total, patients] = await Promise.all([
    Patient.countDocuments(filter),
    Patient.find(filter).sort({ registration_date: -1 }).skip(skip).limit(limit),
  ]);

  // Anonymize results for predictive_analytics role
  const returnedPatients = actor.role === ROLES.PREDICTIVE_ANALYTICS ? anonymizePatients(patients) : patients;

  return {
    results: patients.length,
    patients: returnedPatients,
    pagination: { total, page, pages: Math.ceil(total / limit) || 1, limit },
  };
};

exports.getPatientById = async (patientId, actor = {}) => {
  const patient = await Patient.findOne({ patient_id: patientId });
  if (!patient) throw new AppError('Patient not found.', 404);

  // Ownership enforcement for patient role
  if (actor.role === ROLES.PATIENT && actor.patient_id) {
    const ownerMatch = patient.patient_id === actor.patient_id;
    if (!ownerMatch) throw new AppError('Forbidden: cannot access other patient records.', 403);
  }

  // Anonymize for analytics role
  if (actor.role === ROLES.PREDICTIVE_ANALYTICS) return anonymizePatient(patient);

  return patient;
};

exports.updatePatient = async (patientId, updates, actor) => {
  // Prevent changing immutable patient_id
  if (updates.patient_id) delete updates.patient_id;
  updates.updated_by = actor?.id;

  if (actor?.role === ROLES.PATIENT) {
    if (!actor.patient_id || actor.patient_id !== patientId) {
      throw new AppError('Forbidden: cannot update another patient profile.', 403);
    }

    const allowedFields = new Set([
      'contact_number',
      'email_address',
      'address',
      'emergency_contact_name',
      'emergency_contact_relationship',
      'emergency_contact_phone',
    ]);
    Object.keys(updates).forEach((key) => {
      if (!allowedFields.has(key) && key !== 'updated_by' && key !== '__v') {
        delete updates[key];
      }
    });
  }

  // Support optimistic locking: clients can send __v in updates to assert version
  const clientVersion = typeof updates.__v !== 'undefined' ? updates.__v : null;
  if (typeof updates.__v !== 'undefined') delete updates.__v;

  const patientDoc = await Patient.findOne({ patient_id: patientId });
  if (!patientDoc) throw new AppError('Patient not found.', 404);
  const before = patientDoc.toObject({ versionKey: false });

  if (clientVersion !== null && patientDoc.__v !== clientVersion) {
    const err = new AppError('Conflict: resource has been modified.', 409);
    err.currentVersion = patientDoc.__v;
    throw err;
  }

  Object.keys(updates).forEach((k) => {
    if (k === 'lifestyle') {
      patientDoc.lifestyle = normalizeLifestyle({
        ...(patientDoc.lifestyle?.toObject ? patientDoc.lifestyle.toObject() : patientDoc.lifestyle || {}),
        ...(updates.lifestyle || {}),
      });
      return;
    }
    patientDoc[k] = updates[k];
  });

  await patientDoc.save();

  logger.info({ event: 'PATIENT_UPDATED', actor_id: actor?.id, actor_role: actor?.role, ip: actor?.ip, patient_id: patientId });
  const diff = auditService.diffValues(before, patientDoc);
  await auditService.logAuditEvent({
    actor,
    action: 'UPDATE_PATIENT',
    entity_type: 'patient',
    entity_id: patientDoc.patient_id,
    entity_name: `${patientDoc.first_name} ${patientDoc.last_name}`.trim(),
    description: 'Patient updated.',
    old_value: diff.old_value,
    new_value: diff.new_value,
  });
  return patientDoc;
};

exports.softDeletePatient = async (patientId, actor) => {
  const before = await Patient.findOne({ patient_id: patientId });
  if (!before) throw new AppError('Patient not found.', 404);
  const beforeValue = before.toObject({ versionKey: false });
  before.status = 'archived';
  before.updated_by = actor?.id;
  await before.save();
  const patient = before;

  logger.info({ event: 'PATIENT_ARCHIVED', actor_id: actor?.id, actor_role: actor?.role, ip: actor?.ip, patient_id: patientId });
  await auditService.logAuditEvent({
    actor,
    action: 'DELETE_PATIENT',
    entity_type: 'patient',
    entity_id: patient.patient_id,
    entity_name: `${patient.first_name} ${patient.last_name}`.trim(),
    description: 'Patient archived.',
    old_value: auditService.diffValues(beforeValue, patient).old_value,
    new_value: auditService.diffValues(beforeValue, patient).new_value,
  });
  return patient;
};

exports.linkAppointment = async (patientId, appointmentRef, actor) => {
  const before = await Patient.findOne({ patient_id: patientId });
  if (!before) throw new AppError('Patient not found.', 404);
  const patient = await Patient.findOneAndUpdate(
    { patient_id: patientId },
    { $push: { appointment_refs: appointmentRef }, $set: { updated_by: actor?.id } },
    { returnDocument: 'after' }
  );
  if (!patient) throw new AppError('Patient not found.', 404);
  logger.info({ event: 'APPOINTMENT_LINKED', actor_id: actor?.id, actor_role: actor?.role, ip: actor?.ip, patient_id: patientId, appointmentRef });
  const diff = auditService.diffValues(before, patient);
  await auditService.logAuditEvent({
    actor,
    action: 'LINK_PATIENT_APPOINTMENT',
    entity_type: 'patient',
    entity_id: patient.patient_id,
    entity_name: `${patient.first_name} ${patient.last_name}`.trim(),
    description: 'Appointment linked to patient.',
    old_value: diff.old_value,
    new_value: diff.new_value,
  });
  return patient;
};

exports.updateMedicalHistory = async (patientId, medicalHistoryRef, actor) => {
  const before = await Patient.findOne({ patient_id: patientId });
  if (!before) throw new AppError('Patient not found.', 404);
  const patient = await Patient.findOneAndUpdate(
    { patient_id: patientId },
    { $set: { medical_history_ref: medicalHistoryRef, updated_by: actor?.id } },
    { returnDocument: 'after' }
  );
  if (!patient) throw new AppError('Patient not found.', 404);
  logger.info({ event: 'MEDICAL_HISTORY_UPDATED', actor_id: actor?.id, actor_role: actor?.role, ip: actor?.ip, patient_id: patientId });
  const diff = auditService.diffValues(before, patient);
  await auditService.logAuditEvent({
    actor,
    action: 'UPDATE_PATIENT_MEDICAL_HISTORY',
    entity_type: 'patient',
    entity_id: patient.patient_id,
    entity_name: `${patient.first_name} ${patient.last_name}`.trim(),
    description: 'Patient medical history reference updated.',
    old_value: diff.old_value,
    new_value: diff.new_value,
  });
  return patient;
};
