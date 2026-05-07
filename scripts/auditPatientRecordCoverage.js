#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const connectDB = require('../src/config/db');
const Patient = require('../src/api/v1/patients/patient.model');
const User = require('../src/api/v1/auth/user.model');
const HealthRecord = require('../src/api/v1/health-records/healthRecord.model');

const OUTPUT_ROOT = path.join(process.cwd(), 'logs', 'patient-record-coverage');

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const ensureDir = (dirPath) => fs.mkdirSync(dirPath, { recursive: true });
const canonicalPatientName = (patient) => [patient?.first_name, patient?.last_name].filter(Boolean).join(' ').trim();

async function main() {
  const closeWhenDone = mongoose.connection.readyState !== 1;

  try {
    await connectDB();

    const [patients, users, records] = await Promise.all([
      Patient.find({}).lean(),
      User.find({ role: 'patient' }).lean(),
      HealthRecord.find({}).lean(),
    ]);

    const userByPatientId = new Map();
    for (const user of users) {
      if (user.patient_id && !userByPatientId.has(user.patient_id)) {
        userByPatientId.set(user.patient_id, user);
      }
    }

    const recordsByPatientId = new Map();
    for (const record of records) {
      const patientId = String(record.patient_id || '').trim();
      if (!patientId) continue;
      if (!recordsByPatientId.has(patientId)) recordsByPatientId.set(patientId, []);
      recordsByPatientId.get(patientId).push(record);
    }

    const patientsWithVisibleRecords = [];
    const patientsWithAnyRecords = [];
    const patientsMissingVisibleRecords = [];
    const patientsMissingAnyRecords = [];
    const patientsOnlyArchivedRecords = [];
    const duplicateRecordIds = [];
    const orphanedHealthRecords = [];

    const recordIdCounts = new Map();
    for (const record of records) {
      const recordId = String(record.record_id || '').trim();
      if (!recordId) continue;
      recordIdCounts.set(recordId, (recordIdCounts.get(recordId) || 0) + 1);
    }
    for (const [recordId, count] of recordIdCounts.entries()) {
      if (count > 1) duplicateRecordIds.push({ record_id: recordId, count });
    }

    for (const record of records) {
      const patientId = String(record.patient_id || '').trim();
      const patient = patientId ? patients.find((item) => item.patient_id === patientId) : null;
      if (!patient) {
        orphanedHealthRecords.push({
          record_id: record.record_id,
          patient_id: record.patient_id || '',
          patient_name: record.patient_name || '',
          archived: Boolean(record.archived),
          save_state: record.save_state || '',
          record_type: record.record_type || '',
        });
      }
    }

    for (const patient of patients) {
      const patientId = patient.patient_id;
      const patientRecords = recordsByPatientId.get(patientId) || [];
      const visibleRecords = patientRecords.filter((record) => record.archived !== true);
      const finalVisibleRecords = visibleRecords.filter((record) => record.save_state === 'final');
      const archivedRecords = patientRecords.filter((record) => record.archived === true);
      const linkedUser = userByPatientId.get(patientId) || null;

      if (patientRecords.length > 0) patientsWithAnyRecords.push(patientId);
      if (visibleRecords.length > 0) patientsWithVisibleRecords.push(patientId);

      if (patientRecords.length === 0) {
        patientsMissingAnyRecords.push({
          patient_id: patientId,
          patient_name: canonicalPatientName(patient),
          user_id: linkedUser ? String(linkedUser._id) : null,
          user_email: linkedUser?.email || null,
          patient_status: patient.status || '',
          visible_record_count: 0,
          total_record_count: 0,
          final_visible_record_count: 0,
          likely_cause: 'no_health_records_found',
        });
      }

      if (visibleRecords.length === 0) {
        const likelyCause = patientRecords.length === 0
          ? 'no_health_records_found'
          : archivedRecords.length === patientRecords.length
            ? 'all_records_archived_and_hidden_by_api_default'
            : 'records_exist_but_not_visible_for_another_reason';

        const row = {
          patient_id: patientId,
          patient_name: canonicalPatientName(patient),
          user_id: linkedUser ? String(linkedUser._id) : null,
          user_email: linkedUser?.email || null,
          patient_status: patient.status || '',
          visible_record_count: visibleRecords.length,
          total_record_count: patientRecords.length,
          archived_record_count: archivedRecords.length,
          final_visible_record_count: finalVisibleRecords.length,
          likely_cause: likelyCause,
        };
        patientsMissingVisibleRecords.push(row);
        if (archivedRecords.length === patientRecords.length && patientRecords.length > 0) {
          patientsOnlyArchivedRecords.push(row);
        }
      }
    }

    const totalPatients = patients.length;
    const totalRecords = records.length;
    const visibleRecordsTotal = records.filter((record) => record.archived !== true).length;
    const patientsWithAnyCount = patientsWithAnyRecords.length;
    const patientsWithVisibleCount = patientsWithVisibleRecords.length;
    const missingAnyCount = patientsMissingAnyRecords.length;
    const missingVisibleCount = patientsMissingVisibleRecords.length;
    const coverageAny = totalPatients ? ((patientsWithAnyCount / totalPatients) * 100).toFixed(2) : '0.00';
    const coverageVisible = totalPatients ? ((patientsWithVisibleCount / totalPatients) * 100).toFixed(2) : '0.00';

    const report = {
      generated_at: new Date().toISOString(),
      summary: {
        total_patients: totalPatients,
        total_health_records: totalRecords,
        total_visible_health_records: visibleRecordsTotal,
        patients_with_at_least_one_record: patientsWithAnyCount,
        patients_with_at_least_one_visible_record: patientsWithVisibleCount,
        patients_with_zero_records: missingAnyCount,
        patients_with_zero_visible_records: missingVisibleCount,
        percentage_with_any_record: coverageAny,
        percentage_with_visible_record: coverageVisible,
        orphaned_health_records: orphanedHealthRecords.length,
        duplicate_record_ids: duplicateRecordIds.length,
      },
      patients_missing_any_records: patientsMissingAnyRecords,
      patients_missing_visible_records: patientsMissingVisibleRecords,
      patients_only_archived_records: patientsOnlyArchivedRecords,
      duplicate_record_ids: duplicateRecordIds,
      orphaned_health_records: orphanedHealthRecords,
      analysis: {
        patients_endpoint_behavior: 'Returns patients without filtering archived/inactive unless query.status is provided.',
        health_records_endpoint_behavior: 'Filters archived records by default unless include_archived=true. Does not filter drafts unless query.save_state is provided.',
      },
    };

    const outputDir = path.join(OUTPUT_ROOT, stamp());
    ensureDir(outputDir);
    const outputPath = path.join(outputDir, 'coverage-report.json');
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.log('Patient to health-record coverage audit');
    console.log(`Total patients: ${totalPatients}`);
    console.log(`Total health records: ${totalRecords}`);
    console.log(`Visible health records by default API behavior: ${visibleRecordsTotal}`);
    console.log(`Patients with at least one record: ${patientsWithAnyCount} (${coverageAny}%)`);
    console.log(`Patients with at least one visible record: ${patientsWithVisibleCount} (${coverageVisible}%)`);
    console.log(`Patients missing records entirely: ${missingAnyCount}`);
    console.log(`Patients missing visible records: ${missingVisibleCount}`);
    console.log(`Duplicate record IDs: ${duplicateRecordIds.length}`);
    console.log(`Orphaned health records: ${orphanedHealthRecords.length}`);

    if (patientsMissingVisibleRecords.length) {
      console.log('\nAffected patient IDs');
      for (const row of patientsMissingVisibleRecords) {
        console.log(
          `- ${row.patient_id} | ${row.patient_name} | user_id=${row.user_id || 'n/a'} | total=${row.total_record_count} | visible=${row.visible_record_count} | cause=${row.likely_cause}`
        );
      }
    }

    console.log(`\nCoverage report written to ${outputPath}`);

    process.exit(patientsMissingVisibleRecords.length || orphanedHealthRecords.length || duplicateRecordIds.length ? 2 : 0);
  } finally {
    if (closeWhenDone) {
      await mongoose.connection.close().catch(() => undefined);
    }
  }
}

main().catch((err) => {
  console.error('Coverage audit failed:', err);
  process.exit(1);
});
