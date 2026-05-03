const Patient = require('./patient.model');
const generatePatientId = require('../../../utils/patientIdGenerator');
const AppError = require('../../../utils/AppError');
const logger = require('../../../utils/logger');
const { ROLES } = require('../../../config/constants');
const { anonymizePatient, anonymizePatients } = require('../../../utils/anonymize');

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
    const toCreate = Object.assign({}, data, { patient_id, created_by: actor?.id });
    try {
      patient = await Patient.create(toCreate);
      logger.info({ event: 'PATIENT_CREATED', actor_id: actor?.id, actor_role: actor?.role, ip: actor?.ip, patient_id });
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
  if (actor.role === ROLES.PATIENT && actor.id) {
    filter.$or = [{ created_by: actor.id }, { patient_id: actor.id }];
  }
  if (query.status) filter.status = query.status;
  if (query.search) {
    const q = query.search;
    filter.$or = [
      { first_name: new RegExp(q, 'i') },
      { last_name: new RegExp(q, 'i') },
      { contact_number: new RegExp(q, 'i') },
    ];
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
  if (actor.role === ROLES.PATIENT && actor.id) {
    const ownerMatch = (patient.created_by && patient.created_by === actor.id) || (patient.patient_id && patient.patient_id === actor.id);
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

  // Support optimistic locking: clients can send __v in updates to assert version
  const clientVersion = typeof updates.__v !== 'undefined' ? updates.__v : null;
  if (typeof updates.__v !== 'undefined') delete updates.__v;

  const patientDoc = await Patient.findOne({ patient_id: patientId });
  if (!patientDoc) throw new AppError('Patient not found.', 404);

  if (clientVersion !== null && patientDoc.__v !== clientVersion) {
    const err = new AppError('Conflict: resource has been modified.', 409);
    err.currentVersion = patientDoc.__v;
    throw err;
  }

  Object.keys(updates).forEach((k) => {
    patientDoc[k] = updates[k];
  });

  await patientDoc.save();

  logger.info({ event: 'PATIENT_UPDATED', actor_id: actor?.id, actor_role: actor?.role, ip: actor?.ip, patient_id: patientId });
  return patientDoc;
};

exports.softDeletePatient = async (patientId, actor) => {
  const patient = await Patient.findOneAndUpdate(
    { patient_id: patientId },
    { $set: { status: 'archived', updated_by: actor?.id } },
    { new: true }
  );
  if (!patient) throw new AppError('Patient not found.', 404);

  logger.info({ event: 'PATIENT_ARCHIVED', actor_id: actor?.id, actor_role: actor?.role, ip: actor?.ip, patient_id: patientId });
  return patient;
};

exports.linkAppointment = async (patientId, appointmentRef, actor) => {
  const patient = await Patient.findOneAndUpdate(
    { patient_id: patientId },
    { $push: { appointment_refs: appointmentRef }, $set: { updated_by: actor?.id } },
    { new: true }
  );
  if (!patient) throw new AppError('Patient not found.', 404);
  logger.info({ event: 'APPOINTMENT_LINKED', actor_id: actor?.id, actor_role: actor?.role, ip: actor?.ip, patient_id: patientId, appointmentRef });
  return patient;
};

exports.updateMedicalHistory = async (patientId, medicalHistoryRef, actor) => {
  const patient = await Patient.findOneAndUpdate(
    { patient_id: patientId },
    { $set: { medical_history_ref: medicalHistoryRef, updated_by: actor?.id } },
    { new: true }
  );
  if (!patient) throw new AppError('Patient not found.', 404);
  logger.info({ event: 'MEDICAL_HISTORY_UPDATED', actor_id: actor?.id, actor_role: actor?.role, ip: actor?.ip, patient_id: patientId });
  return patient;
};
