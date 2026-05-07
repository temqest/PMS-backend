const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const connectDB = require('../../src/config/db');
const Patient = require('../../src/api/v1/patients/patient.model');
const User = require('../../src/api/v1/auth/user.model');
const Appointment = require('../../src/api/v1/appointments/appointment.model');
const HealthRecord = require('../../src/api/v1/health-records/healthRecord.model');
const PrescriptionInvoice = require('../../src/api/v1/prescription-invoices/prescriptionInvoice.model');

const DEFAULT_EXPORT_ROOT = path.join(process.cwd(), 'logs', 'relationship-audits');

const normalizeString = (value) => String(value || '').trim();
const normalizeLower = (value) => normalizeString(value).toLowerCase();
const normalizeName = (value) => normalizeLower(value).replace(/\s+/g, ' ');
const uniqueSorted = (values) => [...new Set((values || []).filter(Boolean).map((value) => String(value)))].sort();

const canonicalPatientName = (patient) =>
  [patient?.first_name, patient?.last_name].map((part) => normalizeString(part)).filter(Boolean).join(' ').trim();

const clone = (value) => JSON.parse(JSON.stringify(value));

const toArrayMap = (items, keyFn) => {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
};

const toSingleMap = (items, keyFn) => {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    map.set(key, item);
  }
  return map;
};

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const createReport = (options = {}) => ({
  generated_at: new Date().toISOString(),
  options: {
    seedOnly: options.seedOnly === true,
  },
  counts: {},
  issues: {
    health_records_missing_patient_id: [],
    health_records_orphaned_patient: [],
    health_records_wrong_patient: [],
    health_records_patient_name_mismatch: [],
    health_records_appointment_mismatch: [],
    appointments_missing_patient_id: [],
    appointments_orphaned_patient: [],
    appointments_patient_name_mismatch: [],
    prescription_invoices_missing_patient_id: [],
    prescription_invoices_orphaned_patient: [],
    prescription_invoices_health_record_mismatch: [],
    prescription_invoices_patient_name_mismatch: [],
    patients_missing_user_account: [],
    patient_users_missing_profile: [],
    patient_users_missing_patient_id: [],
    duplicate_patient_records_for_one_user: [],
    duplicate_user_credentials_for_one_patient: [],
    patients_reference_mismatches: [],
    seed_relationship_issues: [],
  },
  repair_plan: [],
  manual_review: [],
  summary: {},
});

const addIssue = (report, key, payload) => {
  report.issues[key].push(payload);
};

const addRepair = (report, repair) => {
  report.repair_plan.push(repair);
};

const addManualReview = (report, payload) => {
  report.manual_review.push(payload);
};

const describeRepair = (repair) =>
  `${repair.id} [${repair.confidence}] ${repair.collection} ${repair.filterKey} -> ${repair.reason}`;

const buildIndexes = ({ patients, users, appointments, records, invoices }) => {
  const patientById = toSingleMap(patients, (item) => normalizeString(item.patient_id));
  const patientsByName = toArrayMap(patients, (item) => normalizeName(canonicalPatientName(item)));
  const patientsByEmail = toArrayMap(patients, (item) => normalizeLower(item.email_address));
  const usersByPatientId = toArrayMap(users, (item) => normalizeString(item.patient_id));
  const usersByEmail = toArrayMap(users, (item) => normalizeLower(item.email));
  const appointmentsById = toSingleMap(appointments, (item) => normalizeString(item.appointment_id));
  const appointmentsByPatientId = toArrayMap(appointments, (item) => normalizeString(item.patient_id));
  const recordsById = toSingleMap(records, (item) => normalizeString(item.record_id));
  const recordsByPatientId = toArrayMap(records, (item) => normalizeString(item.patient_id));
  const invoicesById = toSingleMap(invoices, (item) => normalizeString(item.invoice_id));
  const invoicesByPatientId = toArrayMap(invoices, (item) => normalizeString(item.patient_id));
  const invoicesByHealthRecordId = toArrayMap(invoices, (item) => normalizeString(item.health_record_id));

  return {
    patientById,
    patientsByName,
    patientsByEmail,
    usersByPatientId,
    usersByEmail,
    appointmentsById,
    appointmentsByPatientId,
    recordsById,
    recordsByPatientId,
    invoicesById,
    invoicesByPatientId,
    invoicesByHealthRecordId,
  };
};

const buildPatientRefUpdate = (patient, indexes) => {
  const actualAppointments = uniqueSorted((indexes.appointmentsByPatientId.get(patient.patient_id) || []).map((item) => item.appointment_id));
  const actualInvoices = uniqueSorted((indexes.invoicesByPatientId.get(patient.patient_id) || []).map((item) => item.invoice_id));
  const actualVisitRecords = (indexes.recordsByPatientId.get(patient.patient_id) || [])
    .filter((item) => item.record_type === 'Visit')
    .sort((a, b) => new Date(a.record_date).getTime() - new Date(b.record_date).getTime());

  return {
    appointment_refs: actualAppointments,
    billing_refs: actualInvoices,
    medical_history_ref: actualVisitRecords[0]?.record_id || '',
  };
};

const pushPatientRefRepairIfNeeded = (report, patient, indexes) => {
  const desired = buildPatientRefUpdate(patient, indexes);
  const currentAppointmentRefs = uniqueSorted(patient.appointment_refs || []);
  const currentBillingRefs = uniqueSorted(patient.billing_refs || []);
  const currentMedicalHistoryRef = normalizeString(patient.medical_history_ref);

  if (
    JSON.stringify(currentAppointmentRefs) === JSON.stringify(desired.appointment_refs) &&
    JSON.stringify(currentBillingRefs) === JSON.stringify(desired.billing_refs) &&
    currentMedicalHistoryRef === desired.medical_history_ref
  ) {
    return;
  }

  addIssue(report, 'patients_reference_mismatches', {
    patient_id: patient.patient_id,
    current: {
      appointment_refs: currentAppointmentRefs,
      billing_refs: currentBillingRefs,
      medical_history_ref: currentMedicalHistoryRef,
    },
    expected: desired,
  });

  addRepair(report, {
    id: `patient-refs:${patient.patient_id}`,
    confidence: 'high',
    kind: 'rebuild_patient_refs',
    collection: 'patients',
    filter: { patient_id: patient.patient_id },
    filterKey: patient.patient_id,
    update: desired,
    reason: 'Rebuild denormalized patient references from appointments, health records, and invoices.',
  });
};

const auditRelationships = async (options = {}) => {
  const report = createReport(options);
  const closeWhenDone = mongoose.connection.readyState !== 1;

  try {
    await connectDB();

    const patientFilter = options.seedOnly ? { created_by: 'seed-script' } : {};
    const patients = await Patient.find(patientFilter).lean();
    const patientIds = patients.map((item) => item.patient_id);
    const patientIdFilter = options.seedOnly ? { $in: patientIds } : { $exists: true };
    const patientEmailFilter = uniqueSorted(patients.map((item) => normalizeLower(item.email_address)));

    const [users, appointments, records, invoices] = await Promise.all([
      options.seedOnly
        ? User.find({
            role: 'patient',
            $or: [{ patient_id: { $in: patientIds } }, { email: { $in: patientEmailFilter } }],
          }).lean()
        : User.find({ role: 'patient' }).lean(),
      options.seedOnly ? Appointment.find({ patient_id: patientIdFilter }).lean() : Appointment.find({}).lean(),
      options.seedOnly ? HealthRecord.find({ patient_id: patientIdFilter }).lean() : HealthRecord.find({}).lean(),
      options.seedOnly ? PrescriptionInvoice.find({ patient_id: patientIdFilter }).lean() : PrescriptionInvoice.find({}).lean(),
    ]);

    report.counts = {
      patients: patients.length,
      patient_users: users.length,
      appointments: appointments.length,
      health_records: records.length,
      prescription_invoices: invoices.length,
    };

    const indexes = buildIndexes({ patients, users, appointments, records, invoices });

    for (const [email, groupedPatients] of indexes.patientsByEmail.entries()) {
      if (!email || groupedPatients.length <= 1) continue;
      const linkedUsers = indexes.usersByEmail.get(email) || [];
      addIssue(report, 'duplicate_patient_records_for_one_user', {
        email,
        patient_ids: groupedPatients.map((item) => item.patient_id),
        user_ids: linkedUsers.map((item) => String(item._id)),
      });
      addManualReview(report, {
        type: 'duplicate_patient_email',
        email,
        patient_ids: groupedPatients.map((item) => item.patient_id),
        reason: 'Multiple patient profiles share one email address, so user-to-patient matching by email is ambiguous.',
      });
    }

    for (const [patientId, groupedUsers] of indexes.usersByPatientId.entries()) {
      if (!patientId || groupedUsers.length <= 1) continue;
      addIssue(report, 'duplicate_user_credentials_for_one_patient', {
        patient_id: patientId,
        user_ids: groupedUsers.map((item) => String(item._id)),
        emails: groupedUsers.map((item) => item.email),
      });
      addManualReview(report, {
        type: 'duplicate_users_for_patient',
        patient_id: patientId,
        user_ids: groupedUsers.map((item) => String(item._id)),
        reason: 'Multiple patient-role users reference the same patient_id.',
      });
    }

    for (const patient of patients) {
      const linkedUsers = indexes.usersByPatientId.get(patient.patient_id) || [];
      if (!linkedUsers.length) {
        addIssue(report, 'patients_missing_user_account', {
          patient_id: patient.patient_id,
          email_address: patient.email_address || '',
          created_by: patient.created_by || '',
        });
      }

      pushPatientRefRepairIfNeeded(report, patient, indexes);
    }

    for (const user of users) {
      const userId = String(user._id);
      const patientId = normalizeString(user.patient_id);
      const email = normalizeLower(user.email);
      const matchedById = patientId ? indexes.patientById.get(patientId) : null;
      const matchedByEmail = email ? indexes.patientsByEmail.get(email) || [] : [];

      if (!patientId) {
        addIssue(report, 'patient_users_missing_patient_id', {
          user_id: userId,
          email: user.email,
        });

        if (matchedByEmail.length === 1) {
          const patient = matchedByEmail[0];
          addRepair(report, {
            id: `user-patient-id:${userId}`,
            confidence: 'high',
            kind: 'sync_user_patient_id_by_email',
            collection: 'users',
            filter: { _id: String(user._id) },
            filterKey: user.email,
            update: {
              patient_id: patient.patient_id,
              fullName: canonicalPatientName(patient),
            },
            reason: 'Patient-role user is missing patient_id, and exactly one patient matches the same email address.',
          });
        } else if (matchedByEmail.length > 1) {
          addManualReview(report, {
            type: 'user_missing_patient_id_ambiguous_email',
            user_id: userId,
            email: user.email,
            patient_ids: matchedByEmail.map((item) => item.patient_id),
            reason: 'User email matches multiple patients; cannot choose a patient_id safely.',
          });
        }
        continue;
      }

      if (!matchedById) {
        addIssue(report, 'patient_users_missing_profile', {
          user_id: userId,
          email: user.email,
          patient_id: patientId,
        });

        if (matchedByEmail.length === 1) {
          const patient = matchedByEmail[0];
          addRepair(report, {
            id: `user-orphan-fix:${userId}`,
            confidence: 'high',
            kind: 'sync_user_patient_id_by_email',
            collection: 'users',
            filter: { _id: String(user._id) },
            filterKey: user.email,
            update: {
              patient_id: patient.patient_id,
              fullName: canonicalPatientName(patient),
            },
            reason: 'Patient-role user references a missing patient_id, but exactly one patient matches the same email address.',
          });
        } else {
          addManualReview(report, {
            type: 'user_orphaned_patient_id',
            user_id: userId,
            email: user.email,
            patient_id: patientId,
            patient_matches_by_email: matchedByEmail.map((item) => item.patient_id),
            reason: 'Patient-role user points to a missing patient profile and no single replacement can be chosen safely.',
          });
        }
      }
    }

    for (const appointment of appointments) {
      const patientId = normalizeString(appointment.patient_id);
      const patient = patientId ? indexes.patientById.get(patientId) : null;
      const canonicalName = patient ? canonicalPatientName(patient) : '';
      const appointmentName = normalizeString(appointment.patient_name);

      if (!patientId) {
        addIssue(report, 'appointments_missing_patient_id', {
          appointment_id: appointment.appointment_id,
          patient_name: appointment.patient_name || '',
        });
        continue;
      }

      if (!patient) {
        addIssue(report, 'appointments_orphaned_patient', {
          appointment_id: appointment.appointment_id,
          patient_id: appointment.patient_id,
          patient_name: appointment.patient_name || '',
        });
        const matchedByName = indexes.patientsByName.get(normalizeName(appointment.patient_name)) || [];
        if (matchedByName.length === 1) {
          const target = matchedByName[0];
          addManualReview(report, {
            type: 'appointment_orphan_unique_name_match',
            appointment_id: appointment.appointment_id,
            current_patient_id: appointment.patient_id,
            suggested_patient_id: target.patient_id,
            reason: 'Appointment patient_id is orphaned. A unique patient_name match exists, but the link is still treated as manual review.',
          });
        }
        continue;
      }

      if (normalizeName(appointmentName) !== normalizeName(canonicalName)) {
        addIssue(report, 'appointments_patient_name_mismatch', {
          appointment_id: appointment.appointment_id,
          patient_id: appointment.patient_id,
          current_patient_name: appointment.patient_name || '',
          expected_patient_name: canonicalName,
        });
        addRepair(report, {
          id: `appointment-name:${appointment.appointment_id}`,
          confidence: 'high',
          kind: 'sync_patient_name',
          collection: 'appointments',
          filter: { appointment_id: appointment.appointment_id },
          filterKey: appointment.appointment_id,
          update: { patient_name: canonicalName },
          reason: 'Appointment patient_name does not match the canonical patient profile name.',
        });
      }
    }

    for (const record of records) {
      const patientId = normalizeString(record.patient_id);
      const patient = patientId ? indexes.patientById.get(patientId) : null;
      const canonicalName = patient ? canonicalPatientName(patient) : '';
      const recordName = normalizeString(record.patient_name);
      const appointmentId = normalizeString(record.details?.appointmentId);
      const linkedAppointment = appointmentId ? indexes.appointmentsById.get(appointmentId) : null;

      if (!patientId) {
        addIssue(report, 'health_records_missing_patient_id', {
          record_id: record.record_id,
          patient_name: record.patient_name || '',
          record_type: record.record_type,
        });

        if (linkedAppointment && indexes.patientById.get(linkedAppointment.patient_id)) {
          const target = indexes.patientById.get(linkedAppointment.patient_id);
          addRepair(report, {
            id: `record-missing-patient:${record.record_id}`,
            confidence: 'high',
            kind: 'sync_record_patient_from_appointment',
            collection: 'healthrecords',
            filter: { record_id: record.record_id },
            filterKey: record.record_id,
            update: {
              patient_id: target.patient_id,
              patient_name: canonicalPatientName(target),
            },
            reason: 'Visit health record is missing patient_id, and its linked appointment points to exactly one valid patient.',
          });
        }
        continue;
      }

      if (!patient) {
        addIssue(report, 'health_records_orphaned_patient', {
          record_id: record.record_id,
          patient_id: record.patient_id,
          patient_name: record.patient_name || '',
          record_type: record.record_type,
        });

        if (linkedAppointment && indexes.patientById.get(linkedAppointment.patient_id)) {
          const target = indexes.patientById.get(linkedAppointment.patient_id);
          addRepair(report, {
            id: `record-orphan-patient:${record.record_id}`,
            confidence: 'high',
            kind: 'sync_record_patient_from_appointment',
            collection: 'healthrecords',
            filter: { record_id: record.record_id },
            filterKey: record.record_id,
            update: {
              patient_id: target.patient_id,
              patient_name: canonicalPatientName(target),
            },
            reason: 'Health record references a missing patient_id, and its linked appointment identifies the patient unambiguously.',
          });
        } else {
          const matchedByName = indexes.patientsByName.get(normalizeName(record.patient_name)) || [];
          if (matchedByName.length === 1) {
            addManualReview(report, {
              type: 'record_orphan_unique_name_match',
              record_id: record.record_id,
              current_patient_id: record.patient_id,
              suggested_patient_id: matchedByName[0].patient_id,
              reason: 'Health record patient_id is orphaned. A unique patient_name match exists, but the script will not apply that fix automatically.',
            });
          }
        }
        continue;
      }

      if (normalizeName(recordName) !== normalizeName(canonicalName)) {
        const matchedByName = indexes.patientsByName.get(normalizeName(record.patient_name)) || [];
        const wrongPatientTarget = matchedByName.length === 1 ? matchedByName[0] : null;

        addIssue(report, 'health_records_patient_name_mismatch', {
          record_id: record.record_id,
          patient_id: record.patient_id,
          current_patient_name: record.patient_name || '',
          expected_patient_name: canonicalName,
          suggested_patient_id: wrongPatientTarget && wrongPatientTarget.patient_id !== record.patient_id
            ? wrongPatientTarget.patient_id
            : null,
        });

        addRepair(report, {
          id: `record-name:${record.record_id}`,
          confidence: 'high',
          kind: 'sync_patient_name',
          collection: 'healthrecords',
          filter: { record_id: record.record_id },
          filterKey: record.record_id,
          update: { patient_name: canonicalName },
          reason: 'Health record patient_name does not match the canonical patient profile name.',
        });

        if (wrongPatientTarget && wrongPatientTarget.patient_id !== record.patient_id) {
          addIssue(report, 'health_records_wrong_patient', {
            record_id: record.record_id,
            current_patient_id: record.patient_id,
            current_patient_name: record.patient_name || '',
            suggested_patient_id: wrongPatientTarget.patient_id,
            suggested_patient_name: canonicalPatientName(wrongPatientTarget),
            reason: 'Health record name matches a different patient profile than the patient_id on the record.',
          });
          addManualReview(report, {
            type: 'record_wrong_patient_name_conflict',
            record_id: record.record_id,
            current_patient_id: record.patient_id,
            suggested_patient_id: wrongPatientTarget.patient_id,
            reason: 'The record may belong to another patient, but a name-only reassignment is not applied automatically.',
          });
        }
      }

      if (linkedAppointment && linkedAppointment.patient_id !== record.patient_id) {
        const target = indexes.patientById.get(linkedAppointment.patient_id);
        addIssue(report, 'health_records_appointment_mismatch', {
          record_id: record.record_id,
          record_patient_id: record.patient_id,
          appointment_id: linkedAppointment.appointment_id,
          appointment_patient_id: linkedAppointment.patient_id,
        });
        if (target) {
          addRepair(report, {
            id: `record-appointment:${record.record_id}`,
            confidence: 'high',
            kind: 'sync_record_patient_from_appointment',
            collection: 'healthrecords',
            filter: { record_id: record.record_id },
            filterKey: record.record_id,
            update: {
              patient_id: target.patient_id,
              patient_name: canonicalPatientName(target),
            },
            reason: 'Visit record patient_id conflicts with its linked appointment patient_id.',
          });
        }
      }
    }

    for (const invoice of invoices) {
      const patientId = normalizeString(invoice.patient_id);
      const patient = patientId ? indexes.patientById.get(patientId) : null;
      const canonicalName = patient ? canonicalPatientName(patient) : '';
      const invoiceName = normalizeString(invoice.patient_name);
      const linkedRecord = normalizeString(invoice.health_record_id)
        ? indexes.recordsById.get(normalizeString(invoice.health_record_id))
        : null;

      if (!patientId) {
        addIssue(report, 'prescription_invoices_missing_patient_id', {
          invoice_id: invoice.invoice_id,
          patient_name: invoice.patient_name || '',
          health_record_id: invoice.health_record_id || '',
        });
        if (linkedRecord && indexes.patientById.get(linkedRecord.patient_id)) {
          const target = indexes.patientById.get(linkedRecord.patient_id);
          addRepair(report, {
            id: `invoice-missing-patient:${invoice.invoice_id}`,
            confidence: 'high',
            kind: 'sync_invoice_patient_from_record',
            collection: 'prescriptioninvoices',
            filter: { invoice_id: invoice.invoice_id },
            filterKey: invoice.invoice_id,
            update: {
              patient_id: target.patient_id,
              patient_name: canonicalPatientName(target),
            },
            reason: 'Invoice is missing patient_id, and its linked health record identifies the patient unambiguously.',
          });
        }
        continue;
      }

      if (!patient) {
        addIssue(report, 'prescription_invoices_orphaned_patient', {
          invoice_id: invoice.invoice_id,
          patient_id: invoice.patient_id,
          patient_name: invoice.patient_name || '',
          health_record_id: invoice.health_record_id || '',
        });

        if (linkedRecord && indexes.patientById.get(linkedRecord.patient_id)) {
          const target = indexes.patientById.get(linkedRecord.patient_id);
          addRepair(report, {
            id: `invoice-orphan-patient:${invoice.invoice_id}`,
            confidence: 'high',
            kind: 'sync_invoice_patient_from_record',
            collection: 'prescriptioninvoices',
            filter: { invoice_id: invoice.invoice_id },
            filterKey: invoice.invoice_id,
            update: {
              patient_id: target.patient_id,
              patient_name: canonicalPatientName(target),
            },
            reason: 'Invoice patient_id is orphaned, and the linked health record identifies the patient unambiguously.',
          });
        }
        continue;
      }

      if (normalizeName(invoiceName) !== normalizeName(canonicalName)) {
        addIssue(report, 'prescription_invoices_patient_name_mismatch', {
          invoice_id: invoice.invoice_id,
          patient_id: invoice.patient_id,
          current_patient_name: invoice.patient_name || '',
          expected_patient_name: canonicalName,
        });
        addRepair(report, {
          id: `invoice-name:${invoice.invoice_id}`,
          confidence: 'high',
          kind: 'sync_patient_name',
          collection: 'prescriptioninvoices',
          filter: { invoice_id: invoice.invoice_id },
          filterKey: invoice.invoice_id,
          update: { patient_name: canonicalName },
          reason: 'Invoice patient_name does not match the canonical patient profile name.',
        });
      }

      if (linkedRecord && linkedRecord.patient_id !== invoice.patient_id) {
        const target = indexes.patientById.get(linkedRecord.patient_id);
        addIssue(report, 'prescription_invoices_health_record_mismatch', {
          invoice_id: invoice.invoice_id,
          invoice_patient_id: invoice.patient_id,
          health_record_id: linkedRecord.record_id,
          health_record_patient_id: linkedRecord.patient_id,
        });
        if (target) {
          addRepair(report, {
            id: `invoice-record:${invoice.invoice_id}`,
            confidence: 'high',
            kind: 'sync_invoice_patient_from_record',
            collection: 'prescriptioninvoices',
            filter: { invoice_id: invoice.invoice_id },
            filterKey: invoice.invoice_id,
            update: {
              patient_id: target.patient_id,
              patient_name: canonicalPatientName(target),
            },
            reason: 'Invoice patient_id conflicts with the patient_id on its linked health record.',
          });
        }
      }
    }

    if (options.seedOnly) {
      for (const patient of patients) {
        const linkedUsers = indexes.usersByPatientId.get(patient.patient_id) || [];
        if (linkedUsers.length !== 1) {
          addIssue(report, 'seed_relationship_issues', {
            patient_id: patient.patient_id,
            issue: 'expected_exactly_one_patient_user',
            linked_user_count: linkedUsers.length,
          });
        }

        const seededRecords = indexes.recordsByPatientId.get(patient.patient_id) || [];
        if (!seededRecords.length) {
          addIssue(report, 'seed_relationship_issues', {
            patient_id: patient.patient_id,
            issue: 'missing_seeded_health_records',
          });
        }
      }
    }

    report.summary = {
      issue_counts: Object.fromEntries(Object.entries(report.issues).map(([key, items]) => [key, items.length])),
      repair_count: report.repair_plan.length,
      manual_review_count: report.manual_review.length,
    };

    return report;
  } finally {
    if (closeWhenDone) {
      await mongoose.connection.close().catch(() => undefined);
    }
  }
};

const exportReport = (report, exportDir = DEFAULT_EXPORT_ROOT) => {
  const targetDir = path.join(exportDir, stamp());
  ensureDir(targetDir);
  const reportPath = path.join(targetDir, 'audit-report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { targetDir, reportPath };
};

const modelByCollection = {
  patients: Patient,
  users: User,
  appointments: Appointment,
  healthrecords: HealthRecord,
  prescriptioninvoices: PrescriptionInvoice,
};

const collectBackups = async (repairs) => {
  const backups = [];
  for (const repair of repairs) {
    const Model = modelByCollection[repair.collection];
    if (!Model) continue;
    const doc = await Model.findOne(repair.filter).lean();
    if (doc) {
      backups.push({
        repair_id: repair.id,
        collection: repair.collection,
        filter: repair.filter,
        document: doc,
      });
    }
  }
  return backups;
};

const writeBackup = (backupRows, exportDir) => {
  ensureDir(exportDir);
  const backupPath = path.join(exportDir, 'affected-documents-backup.json');
  fs.writeFileSync(backupPath, `${JSON.stringify(backupRows, null, 2)}\n`, 'utf8');
  return backupPath;
};

const applyPatientRefRepair = async (repair) => {
  const patientId = normalizeString(repair.filter?.patient_id);
  if (!patientId) return;

  const [patient, appointments, records, invoices] = await Promise.all([
    Patient.findOne({ patient_id: patientId }),
    Appointment.find({ patient_id: patientId }).lean(),
    HealthRecord.find({ patient_id: patientId }).lean(),
    PrescriptionInvoice.find({ patient_id: patientId }).lean(),
  ]);

  if (!patient) return;

  const indexes = buildIndexes({
    patients: [patient.toObject()],
    users: [],
    appointments,
    records,
    invoices,
  });
  const nextRefs = buildPatientRefUpdate(patient.toObject(), indexes);
  await Patient.updateOne({ patient_id: patientId }, { $set: nextRefs });
};

const applyRepairs = async (report, options = {}) => {
  const requestedIds = new Set((options.onlyRepairIds || []).map((value) => String(value)));
  const applyable = report.repair_plan.filter((repair) => {
    if (repair.confidence !== 'high') return false;
    if (!requestedIds.size) return true;
    return requestedIds.has(repair.id);
  });

  const dryRun = options.apply !== true;
  const closeWhenDone = mongoose.connection.readyState !== 1;

  try {
    await connectDB();

    const exportDir = path.join(options.exportRoot || DEFAULT_EXPORT_ROOT, stamp());
    const backups = await collectBackups(applyable);
    const backupPath = writeBackup(backups, exportDir);

    if (dryRun) {
      return {
        applied: false,
        exportDir,
        backupPath,
        selected_repairs: applyable.map((repair) => clone(repair)),
      };
    }

    const appliedRepairs = [];
    const deferredPatientRefRepairs = [];
    for (const repair of applyable) {
      if (repair.kind === 'rebuild_patient_refs') {
        deferredPatientRefRepairs.push(repair);
        continue;
      }
      const Model = modelByCollection[repair.collection];
      if (!Model) continue;
      await Model.updateOne(repair.filter, { $set: repair.update });
      appliedRepairs.push(clone(repair));
    }

    for (const repair of deferredPatientRefRepairs) {
      await applyPatientRefRepair(repair);
      appliedRepairs.push(clone(repair));
    }

    return {
      applied: true,
      exportDir,
      backupPath,
      applied_repairs: appliedRepairs,
    };
  } finally {
    if (closeWhenDone) {
      await mongoose.connection.close().catch(() => undefined);
    }
  }
};

const printReport = (report) => {
  console.log('Relationship audit summary');
  console.log(JSON.stringify(report.summary, null, 2));

  if (report.repair_plan.length) {
    console.log('\nProposed safe repairs');
    for (const repair of report.repair_plan) {
      console.log(`- ${describeRepair(repair)}`);
    }
  }

  if (report.manual_review.length) {
    console.log('\nManual review items');
    for (const item of report.manual_review) {
      console.log(`- ${item.type}: ${item.reason}`);
    }
  }
};

module.exports = {
  auditRelationships,
  applyRepairs,
  exportReport,
  printReport,
  canonicalPatientName,
  normalizeName,
};
