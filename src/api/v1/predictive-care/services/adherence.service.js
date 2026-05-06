const dayjs = require('dayjs');
const HealthRecord = require('../../health-records/healthRecord.model');
const PrescriptionInvoice = require('../../prescription-invoices/prescriptionInvoice.model');
const AdherenceRecord = require('../models/adherenceRecord.model');
const CareAlert = require('../models/careAlert.model');
const PatientRiskProfile = require('../models/patientRiskProfile.model');

const ADHERENCE_GAP_THRESHOLD_DAYS = 14;

const parseMaybeDate = (v) => {
  if (v == null || v === '') return null;
  const d = dayjs(v);
  return d.isValid() ? d.toDate() : null;
};

const parseIntSafe = (v, fallback = 0) => {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isNaN(n) ? fallback : n;
};

/**
 * One row per medicine per prescription health record (supports multi-medicine + form variant).
 */
function prescriptionRowsFromRecord(record) {
  const d = record.details || {};
  const rid = record.record_id;

  if (Array.isArray(d.medicines) && d.medicines.length) {
    const start = parseMaybeDate(d.startDate);
    const end = parseMaybeDate(d.endDate);
    const parentRefills = parseIntSafe(d.refills, 0);
    return d.medicines
      .filter((m) => m && m.medicineName)
      .map((m) => ({
        medicine_name: m.medicineName,
        record_id: rid,
        start_date: start,
        end_date: end,
        quantity: parseIntSafe(m.prescribedQuantity ?? d.quantity, 0),
        refills: parentRefills,
      }));
  }

  const formName = d.prescriptionMedicationName || d.medicationName;
  if (formName) {
    return [
      {
        medicine_name: formName,
        record_id: rid,
        start_date: parseMaybeDate(d.prescriptionStartDate ?? d.startDate),
        end_date: parseMaybeDate(d.prescriptionEndDate ?? d.endDate),
        quantity: parseIntSafe(d.prescriptionQuantity ?? d.quantity, 0),
        refills: parseIntSafe(d.prescriptionRefills ?? d.refills, 0),
      },
    ];
  }

  return [];
}

const findCoverageGaps = (windows) => {
  const sorted = [...windows].filter((w) => w.start_date || w.end_date);
  sorted.sort((a, b) => {
    const ta = dayjs(a.start_date || a.end_date || 0).valueOf();
    const tb = dayjs(b.start_date || b.end_date || 0).valueOf();
    return ta - tb;
  });

  const gaps = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const endA = sorted[i].end_date ? dayjs(sorted[i].end_date) : null;
    const startB = sorted[i + 1].start_date ? dayjs(sorted[i + 1].start_date) : null;
    if (!endA || !startB || !endA.isValid() || !startB.isValid()) continue;
    const gapDays = startB.diff(endA, 'day');
    if (gapDays > 0) {
      gaps.push({ gap_start: endA.toDate(), gap_end: startB.toDate(), gap_days: gapDays });
    }
  }
  return gaps;
};

const computeAdherenceForPatient = async (patient_id, patient_name) => {
  const prescriptionRecords = await HealthRecord.find({
    patient_id,
    record_type: 'Prescription',
    save_state: 'final',
  }).sort({ record_date: 1 });

  const invoices = await PrescriptionInvoice.find({ patient_id });

  const fillMap = {};
  for (const invoice of invoices) {
    for (const item of invoice.items || []) {
      const key = item.medicineName;
      if (!key) continue;
      if (!fillMap[key]) fillMap[key] = [];
      fillMap[key].push({
        invoice_id: invoice.invoice_id,
        fill_date: invoice.invoice_date,
        quantity: item.prescribedQuantity,
      });
    }
  }

  const byMedicine = {};
  for (const record of prescriptionRecords) {
    for (const row of prescriptionRowsFromRecord(record)) {
      const { medicine_name: medicineName } = row;
      if (!byMedicine[medicineName]) byMedicine[medicineName] = [];
      byMedicine[medicineName].push({
        record_id: row.record_id,
        start_date: row.start_date,
        end_date: row.end_date,
        quantity: row.quantity,
        refills: row.refills,
      });
    }
  }

  let overallAdherenceIssues = false;

  for (const [medicineName, windows] of Object.entries(byMedicine)) {
    const gaps = findCoverageGaps(windows);
    const confirmedFills = fillMap[medicineName] || [];
    const significantGaps = gaps.filter((g) => g.gap_days > ADHERENCE_GAP_THRESHOLD_DAYS);
    const longestGap = gaps.reduce((max, g) => Math.max(max, g.gap_days), 0);
    const adherenceScore = Math.max(0, 100 - significantGaps.length * 25);
    const status = adherenceScore >= 75 ? 'Adherent' : adherenceScore >= 40 ? 'Partial' : 'Non-adherent';

    await AdherenceRecord.findOneAndUpdate(
      { patient_id, medicine_name: medicineName },
      {
        patient_id,
        medicine_name: medicineName,
        prescription_windows: windows,
        coverage_gaps: gaps,
        confirmed_fills: confirmedFills,
        adherence_score: adherenceScore,
        status,
        longest_gap_days: longestGap,
        last_assessed_at: new Date(),
      },
      { upsert: true, returnDocument: 'after' }
    );

    if (status !== 'Adherent') {
      overallAdherenceIssues = true;
      await CareAlert.findOneAndUpdate(
        {
          patient_id,
          alert_type: 'ADHERENCE_GAP',
          'metadata.medicine_name': medicineName,
          is_resolved: false,
        },
        {
          patient_id,
          patient_name,
          alert_type: 'ADHERENCE_GAP',
          severity: status === 'Non-adherent' ? 'Warning' : 'Info',
          title: `Adherence gap — ${medicineName}`,
          message: `Patient shows ${status.toLowerCase()} adherence to ${medicineName}. Longest gap: ${longestGap} days.`,
          metadata: {
            medicine_name: medicineName,
            adherence_score: adherenceScore,
            longest_gap_days: longestGap,
            status,
          },
          triggered_at: new Date(),
        },
        { upsert: true, returnDocument: 'after' }
      );
    }
  }

  await PatientRiskProfile.findOneAndUpdate(
    { patient_id },
    { has_adherence_gaps: overallAdherenceIssues },
    { upsert: true }
  );
};

module.exports = {
  computeAdherenceForPatient,
  prescriptionRowsFromRecord,
  windowsFromPrescriptionRecord: prescriptionRowsFromRecord,
  findCoverageGaps,
};
