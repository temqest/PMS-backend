/**
 * Analytics-ready test data seeder.
 *
 * Env:
 *   SEED_PATIENT_COUNT   — default 60
 *   SEED_RANDOM_SEED     — unsigned int for reproducible data (default 42)
 *   SEED_WINDOW_MONTHS   — history window (default 20)
 *   SEED_RUN_PREDICTIVE  — if not "false", runs predictive orchestrator after insert
 *   SEED_HIGH_RISK_COUNT — first N patients get guaranteed High/Critical risk profile data (default 4)
 *
 * Run: node scripts/seedTestData.js
 * Then refresh the analytics dashboard (or run batchComputeRiskProfiles.js if predictive is off).
 */

const mongoose = require('mongoose');
const dayjs = require('dayjs');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Patient = require('../src/api/v1/patients/patient.model');
const Appointment = require('../src/api/v1/appointments/appointment.model');
const HealthRecord = require('../src/api/v1/health-records/healthRecord.model');
const PrescriptionInvoice = require('../src/api/v1/prescription-invoices/prescriptionInvoice.model');
const PatientRiskProfile = require('../src/api/v1/predictive-care/models/patientRiskProfile.model');
const CareAlert = require('../src/api/v1/predictive-care/models/careAlert.model');
const LabTrend = require('../src/api/v1/predictive-care/models/labTrend.model');
const AdherenceRecord = require('../src/api/v1/predictive-care/models/adherenceRecord.model');

const COHORT_CYCLE = [
  'healthy_low_util',
  'chronic_htn_dm',
  'lab_worsening',
  'adherence_gap',
  'vaccination_overdue',
  'no_show',
  'readmission_pattern',
  'high_util',
];

const IMAGING_MODALITIES = ['X-Ray', 'CT', 'MRI', 'Ultrasound', 'PET', 'Mammography'];

const firstNames = [
  'John', 'Jane', 'Michael', 'Sarah', 'David', 'Emma', 'James', 'Olivia', 'Robert', 'Sophia',
  'William', 'Isabella', 'Joseph', 'Ava', 'Charles', 'Maria', 'Daniel', 'Priya', 'Chen', 'Elena',
];
const lastNames = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez',
  'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Patel', 'Kim', 'Nguyen',
];
const addresses = [
  '123 Main St, Cityville',
  '456 Oak Ave, Townburg',
  '789 Pine Rd, Villagetown',
  '321 Elm St, Hamlet',
  '654 Maple Dr, Borough',
  '987 Cedar Ln, Township',
  '147 Birch Blvd, County',
  '258 Spruce Way, District',
];
const physicians = ['Dr. Alice Cooper', 'Dr. Bob Dylan', 'Dr. Carol King', 'Dr. David Bowie', 'Dr. Eve Adams'];
const PHARMACIES = [
  'MedPlus Pharmacy',
  'HealthFirst Drugstore',
  'City Care Pharmacy',
  'QuickMeds',
  'WellCare Pharmacy',
  'Central Drugstore',
  'Family Health Pharmacy',
  'RxPlus',
];
const appointmentReasons = [
  'Routine checkup', 'Follow-up visit', 'Consultation', 'Vaccination', 'Blood test', 'Imaging', 'Prescription refill',
];
const visitSymptoms = ['Headache', 'Fever', 'Cough', 'Back pain', 'Shortness of breath', 'Abdominal pain', 'Joint stiffness'];
const visitTreatments = [
  'Prescribed medication and rest',
  'Lifestyle counseling and follow-up',
  'Refill medication and labs',
  'Physical therapy referral',
  'Dietary advice and monitoring',
];
const vaccinationSites = ['Left Arm', 'Right Arm', 'Left Thigh', 'Right Thigh', 'Other'];
const vaccinationRoutes = ['Intramuscular', 'Subcutaneous', 'Oral', 'Nasal'];
const noteTypes = ['Progress Note', 'Consultation Note', 'Nursing Note', 'Discharge Summary', 'Phone Call'];
const noteTemplates = [
  'Patient is improving with current treatment.',
  'Recommend continuing current therapy.',
  'Patient education provided regarding medication adherence.',
  'Follow-up appointment scheduled in 2 weeks.',
  'Results reviewed and conveyed to patient.',
];
const prescriptionForms = ['Tablet', 'Capsule', 'Liquid', 'Injection', 'Topical'];
const imagingBodyParts = ['Chest', 'Abdomen', 'Head', 'Knee', 'Spine', 'Pelvis', 'Shoulder'];
const imagingImpressions = [
  'No acute abnormality identified.',
  'Findings consistent with mild degeneration.',
  'Small pleural effusion noted.',
  'No fracture or dislocation seen.',
  'Follow-up imaging recommended.',
  'Evidence of inflammation present.',
];

const labTestsMetadata = {
  'Blood glucose': { unit: 'mg/dL', range: '70-140 mg/dL', normalMin: 70, normalMax: 140 },
  Cholesterol: { unit: 'mg/dL', range: '125-200 mg/dL', normalMin: 125, normalMax: 200 },
  CBC: { unit: 'K/uL', range: '4.0-11.0 K/uL', normalMin: 4.0, normalMax: 11.0 },
  'Urine analysis': { unit: '', range: 'Negative', normalMin: 0, normalMax: 0 },
  'Thyroid function': { unit: 'uIU/mL', range: '0.4-4.0 uIU/mL', normalMin: 0.4, normalMax: 4.0 },
  'Liver function': { unit: 'U/L', range: '7-56 U/L', normalMin: 7, normalMax: 56 },
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/pms');
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('DB connection error:', error);
    process.exit(1);
  }
};

function getLabStatus(value, meta) {
  if (meta.normalMin === 0 && meta.normalMax === 0) return 'Normal';
  if (value < meta.normalMin * 0.9 || value > meta.normalMax * 1.25) return 'Critical';
  if (value < meta.normalMin || value > meta.normalMax) return 'Abnormal';
  return 'Normal';
}

function medicineByName(medicines, name) {
  return medicines.find((m) => m.name === name) || medicines[0];
}

function createIdFactory(prefix) {
  let seq = 0;
  return () => `${prefix}-${(++seq).toString(36)}-${Date.now().toString(36)}`;
}

function generatePatientId(sequence) {
  const datePart = dayjs().format('YYYYMMDD');
  return `PAT-${datePart}-${String(sequence).padStart(4, '0')}`;
}

function appointmentCountForCohort(cohort, rnd) {
  const ri = (a, b) => Math.floor(rnd() * (b - a + 1)) + a;
  switch (cohort) {
    case 'healthy_low_util':
      return ri(3, 5);
    case 'chronic_htn_dm':
      return ri(7, 11);
    case 'lab_worsening':
      return ri(6, 9);
    case 'adherence_gap':
      return ri(4, 7);
    case 'vaccination_overdue':
      return ri(4, 7);
    case 'no_show':
      return ri(12, 16);
    case 'readmission_pattern':
      return ri(7, 11);
    case 'high_util':
      return ri(14, 19);
    default:
      return ri(4, 8);
  }
}

function spreadDatesInWindow(n, windowStart, windowEnd, rnd, cohort) {
  const days = Math.max(1, windowEnd.diff(windowStart, 'day'));
  const dates = [];
  for (let i = 0; i < n; i += 1) {
    let d = windowStart.add(Math.floor(rnd() * days), 'day');
    if ((cohort === 'high_util' || rnd() < 0.12) && rnd() < 0.35) {
      const peakStart = windowStart.add(Math.floor(rnd() * Math.max(1, days - 7)), 'day');
      d = peakStart.add(Math.floor(rnd() * 7), 'day');
    }
    if (d.isAfter(windowEnd)) d = windowEnd;
    d = d.hour(8 + Math.floor(rnd() * 9)).minute([0, 15, 30, 45][Math.floor(rnd() * 4)]);
    dates.push(d);
  }
  dates.sort((a, b) => a.valueOf() - b.valueOf());

  if (cohort === 'readmission_pattern' && dates.length >= 2) {
    const recentStart = dayjs().subtract(90, 'day');
    const recentDays = Math.max(1, windowEnd.diff(recentStart, 'day'));
    const reanchor = Math.min(3, dates.length);
    for (let i = dates.length - reanchor; i < dates.length; i += 1) {
      let d = recentStart.add(Math.floor(rnd() * recentDays), 'day');
      if (d.isAfter(windowEnd)) d = windowEnd;
      d = d.hour(8 + Math.floor(rnd() * 9)).minute([0, 15, 30, 45][Math.floor(rnd() * 4)]);
      dates[i] = d;
    }
    dates.sort((a, b) => a.valueOf() - b.valueOf());
  }

  return dates;
}

function pick(rnd, arr) {
  return arr[Math.floor(rnd() * arr.length)];
}

function pickAppointmentStatusForCohort(cohort, rnd, isStrongNoShow) {
  if (cohort === 'no_show' && isStrongNoShow) {
    const r = rnd();
    if (r < 0.38) return 'Cancelled';
    if (r < 0.62) return 'Pending';
    return 'Completed';
  }
  if (cohort === 'healthy_low_util') {
    return rnd() < 0.92 ? 'Completed' : pick(rnd, ['Confirmed', 'Pending']);
  }
  return rnd() < 0.82 ? 'Completed' : pick(rnd, ['Confirmed', 'Pending', 'Cancelled']);
}

function visitProfileForCohort(cohort, aptDate, windowEnd, rnd, recentCutoff) {
  const isRecent = aptDate.isAfter(recentCutoff) || aptDate.isSame(recentCutoff, 'day');
  let visitType = pick(rnd, ['Follow-up', 'Annual Physical', 'Urgent', 'Consultation', 'Procedure']);
  if (cohort === 'readmission_pattern' && isRecent) {
    visitType = rnd() < 0.55 ? 'Urgent' : 'Follow-up';
  } else if (cohort === 'healthy_low_util') {
    visitType = pick(rnd, ['Annual Physical', 'Consultation', 'Follow-up']);
  }

  let diagnosis = pick(rnd, ['Seasonal allergy', 'Upper respiratory infection', 'Gastroenteritis', 'Chronic back pain', 'Anxiety']);
  let assessmentSuffix = pick(rnd, visitTreatments);
  let systolic;
  let diastolic = String(65 + Math.floor(rnd() * 18));

  if (cohort === 'chronic_htn_dm' || cohort === 'lab_worsening') {
    diagnosis = rnd() < 0.55 ? 'Hypertension' : 'Type 2 diabetes';
    assessmentSuffix = pick(rnd, visitTreatments);
    systolic = rnd() < 0.65 ? String(135 + Math.floor(rnd() * 35)) : String(118 + Math.floor(rnd() * 20));
  } else {
    systolic = String(105 + Math.floor(rnd() * 28));
  }

  const visitReason = pick(rnd, visitSymptoms);
  const visitAssessment = `${diagnosis}. ${assessmentSuffix}`;
  const summary = `${visitType} visit for ${visitReason.toLowerCase()}`;

  return {
    visitType,
    visitReason,
    visitAssessment,
    summary,
    visitBpSystolic: systolic,
    visitBpDiastolic: diastolic,
    visitHeartRate: String(58 + Math.floor(rnd() * 48)),
    visitRespiratoryRate: String(12 + Math.floor(rnd() * 10)),
    visitTemperature: String((97.0 + rnd() * 3.5).toFixed(1)),
    visitWeight: String(120 + Math.floor(rnd() * 110)),
    visitHeight: String(60 + Math.floor(rnd() * 16)),
  };
}

function buildPrescriptionRecordRnd({
  patient,
  med,
  record_date: recordDate,
  startDate,
  endDate,
  provider,
  makeRecordId,
  quantity,
  refills,
  rnd,
}) {
  const form = pick(rnd, prescriptionForms);
  const directions = `Take ${quantity} ${med.dosage} ${med.name.toLowerCase()} daily with food.`;
  const pharm = pick(rnd, PHARMACIES);
  const notesForPharmacist = `Dispense at ${pharm}. Verify allergy history.`;
  const prescribedMedicine = {
    medicineId: med.id,
    medicineName: med.name,
    prescribedDosage: med.dosage,
    availableQuantity: Number(med.quantity || 0),
    prescribedQuantity: quantity,
    unitPrice: Number(med.price || 0),
    totalPrice: Number((quantity * Number(med.price || 0)).toFixed(2)),
    expiry: med.expiry || '',
    status: med.status || 'IN STOCK',
  };

  return {
    record_id: makeRecordId(),
    patient_id: patient.patient_id,
    patient_name: `${patient.first_name} ${patient.last_name}`,
    record_type: 'Prescription',
    record_date: recordDate,
    provider,
    save_state: 'final',
    summary: `Prescription for ${med.name}`,
    details: {
      title: med.name,
      summary: directions,
      medicines: [prescribedMedicine],
      medicationName: med.name,
      dosage: med.dosage,
      form,
      directionsForUse: directions,
      quantity,
      refills,
      pharmacy: pharm,
      startDate,
      endDate,
      substitutionAllowed: rnd() > 0.25,
      notes: notesForPharmacist,
      prescriptionMedicationName: med.name,
      prescriptionDosage: med.dosage,
      prescriptionForm: form,
      prescriptionDirections: directions,
      prescriptionQuantity: String(quantity),
      prescriptionRefills: String(refills),
      prescriptionPharmacy: pharm,
      prescriptionStartDate: startDate,
      prescriptionEndDate: endDate,
      prescriptionNotes: notesForPharmacist,
    },
    created_by: 'admin',
  };
}

function buildLabRecord(patient, testName, rawValue, recordDate, provider, makeRecordId, metaOverride) {
  const meta = metaOverride || labTestsMetadata[testName];
  const resultValue = `${rawValue.toFixed(meta.unit === '' ? 0 : 1)}${meta.unit ? ` ${meta.unit}` : ''}`.trim();
  const status = getLabStatus(rawValue, meta);
  const labNotes = status === 'Normal' ? 'Result within expected range.' : 'Abnormal value requires follow-up.';
  return {
    record_id: makeRecordId(),
    patient_id: patient.patient_id,
    patient_name: `${patient.first_name} ${patient.last_name}`,
    record_type: 'Lab Result',
    record_date: recordDate,
    provider,
    save_state: 'final',
    summary: `${testName} ${status.toLowerCase()}`,
    details: {
      title: testName,
      summary: labNotes,
      labTestName: testName,
      labResultValue: resultValue,
      labUnit: meta.unit,
      labReferenceRange: meta.range,
      labStatus: status,
      labFlagForReview: status !== 'Normal',
      labOrderingProvider: provider,
      labNotes,
    },
    created_by: 'admin',
  };
}

function buildVisitRecord(patient, apt, visitFields, provider, makeRecordId) {
  return {
    record_id: makeRecordId(),
    patient_id: patient.patient_id,
    patient_name: `${patient.first_name} ${patient.last_name}`,
    record_type: 'Visit',
    record_date: apt.scheduled_at,
    provider,
    save_state: 'final',
    summary: visitFields.summary,
    details: {
      title: visitFields.visitType,
      summary: visitFields.visitAssessment,
      visitReason: visitFields.visitReason,
      visitType: visitFields.visitType,
      visitBpSystolic: visitFields.visitBpSystolic,
      visitBpDiastolic: visitFields.visitBpDiastolic,
      visitHeartRate: visitFields.visitHeartRate,
      visitRespiratoryRate: visitFields.visitRespiratoryRate,
      visitTemperature: visitFields.visitTemperature,
      visitWeight: visitFields.visitWeight,
      visitHeight: visitFields.visitHeight,
      visitAssessment: visitFields.visitAssessment,
      appointmentId: apt.appointment_id,
    },
    created_by: 'admin',
  };
}

/**
 * Data shaped to exceed overall_risk_score >= 50 after riskScore.service weighting:
 * chronic capped 35%, readmission 25%, no-show 15%, adherence 25%.
 * Uses multiple recent Urgent/Follow-up visits (readmission), cancelled slots (no-show),
 * abnormal labs + HTN/DM assessments + high BP (chronic), and Metformin window gap (adherence).
 */
function generateRiskTierHighBundle({
  patient,
  windowStart,
  windowEnd,
  medicines,
  makeAppointmentId,
  makeRecordId,
  makeInvoiceId,
  rnd,
}) {
  const appointments = [];
  const records = [];
  const invoices = [];
  const metformin = medicineByName(medicines, 'Metformin');
  const provider = pick(rnd, physicians);

  const completedDays = [
    windowStart.add(95, 'day'),
    windowStart.add(165, 'day'),
    windowEnd.subtract(72, 'day'),
    windowEnd.subtract(50, 'day'),
    windowEnd.subtract(35, 'day'),
    windowEnd.subtract(21, 'day'),
    windowEnd.subtract(8, 'day'),
  ];

  for (let i = 0; i < completedDays.length; i += 1) {
    let d = completedDays[i];
    if (d.isAfter(windowEnd)) d = windowEnd.subtract(1, 'hour');
    const appointment_id = makeAppointmentId();
    const scheduledAt = d.hour(10).minute(0).second(0).millisecond(0).toDate();
    appointments.push({
      appointment_id,
      patient_id: patient.patient_id,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      appointment_type: 'In-Person',
      scheduled_at: scheduledAt,
      duration_minutes: 30,
      reason: 'Chronic disease follow-up',
      priority: 'Urgent',
      status: 'Completed',
      created_by: 'admin',
    });
    const visitType =
      i < 2 ? (i === 0 ? 'Consultation' : 'Follow-up') : i % 2 === 0 ? 'Urgent' : 'Follow-up';
    const vf = {
      visitType,
      visitReason: 'Shortness of breath',
      visitAssessment: 'Hypertension and type 2 diabetes. Intensive follow-up and medication titration.',
      summary: `${visitType} visit for chronic care`,
      visitBpSystolic: '152',
      visitBpDiastolic: '94',
      visitHeartRate: '88',
      visitRespiratoryRate: '18',
      visitTemperature: '98.2',
      visitWeight: '198',
      visitHeight: '70',
    };
    records.push(buildVisitRecord(patient, appointments[appointments.length - 1], vf, provider, makeRecordId));
  }

  const cancelOffsets = [12, 28, 44, 118, 142, 205, 248, 292, 335];
  for (const off of cancelOffsets) {
    let d = windowStart.add(off, 'day');
    if (d.isAfter(windowEnd)) continue;
    appointments.push({
      appointment_id: makeAppointmentId(),
      patient_id: patient.patient_id,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      appointment_type: 'In-Person',
      scheduled_at: d.hour(14).minute(30).second(0).millisecond(0).toDate(),
      duration_minutes: 30,
      reason: 'Follow-up',
      priority: 'Routine',
      status: 'Cancelled',
      created_by: 'admin',
    });
  }

  const glucVals = [148, 154, 162, 172];
  for (let k = 0; k < glucVals.length; k += 1) {
    const ld = windowStart.add(50 + k * 45, 'day').hour(9).minute(0).second(0).millisecond(0);
    let labD = ld;
    if (labD.isAfter(windowEnd)) labD = windowEnd.subtract(5 + k, 'day').hour(9).minute(0);
    records.push(
      buildLabRecord(
        patient,
        'Blood glucose',
        glucVals[k],
        labD.toDate(),
        pick(rnd, physicians),
        makeRecordId,
        labTestsMetadata['Blood glucose']
      )
    );
  }

  const base = windowEnd.subtract(130, 'day');
  const w1Start = base.format('YYYY-MM-DD');
  const w1End = base.add(21, 'day').format('YYYY-MM-DD');
  const w2Start = base.add(21 + 55, 'day').format('YYYY-MM-DD');
  const w2End = dayjs(w2Start).add(28, 'day').format('YYYY-MM-DD');
  records.push(
    buildPrescriptionRecordRnd({
      patient,
      med: metformin,
      record_date: base.toDate(),
      startDate: w1Start,
      endDate: w1End,
      provider,
      makeRecordId,
      quantity: 28,
      refills: 0,
      rnd,
    })
  );
  records.push(
    buildPrescriptionRecordRnd({
      patient,
      med: metformin,
      record_date: dayjs(w2Start).toDate(),
      startDate: w2Start,
      endDate: w2End,
      provider: pick(rnd, physicians),
      makeRecordId,
      quantity: 28,
      refills: 0,
      rnd,
    })
  );

  return { appointments, records, invoices };
}

function generatePatientBundle({
  patient,
  cohort,
  rnd,
  windowStart,
  windowEnd,
  medicines,
  makeAppointmentId,
  makeRecordId,
  makeInvoiceId,
}) {
  if (cohort === 'risk_tier_high') {
    return generateRiskTierHighBundle({
      patient,
      windowStart,
      windowEnd,
      medicines,
      makeAppointmentId,
      makeRecordId,
      makeInvoiceId,
      rnd,
    });
  }

  const appointments = [];
  const records = [];
  const invoices = [];

  const nAppts = appointmentCountForCohort(cohort, rnd);
  const dateObjs = spreadDatesInWindow(nAppts, windowStart, windowEnd, rnd, cohort);
  const recentCutoff = dayjs().subtract(90, 'day');

  for (let i = 0; i < dateObjs.length; i += 1) {
    const scheduledAt = dateObjs[i].toDate();
    const status = pickAppointmentStatusForCohort(cohort, rnd, cohort === 'no_show');
    const appointment_id = makeAppointmentId();
    appointments.push({
      appointment_id,
      patient_id: patient.patient_id,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      appointment_type: rnd() < 0.15 ? 'Telehealth' : 'In-Person',
      scheduled_at: scheduledAt,
      duration_minutes: pick(rnd, [15, 30, 45, 60]),
      reason: pick(rnd, appointmentReasons),
      priority: pick(rnd, ['Routine', 'Urgent', 'Follow-up']),
      status,
      created_by: 'admin',
    });

    if (status === 'Completed') {
      const provider = pick(rnd, physicians);
      const vf = visitProfileForCohort(cohort, dateObjs[i], windowEnd, rnd, recentCutoff);
      records.push(buildVisitRecord(patient, appointments[appointments.length - 1], vf, provider, makeRecordId));
    }
  }

  const metformin = medicineByName(medicines, 'Metformin');
  const provider = pick(rnd, physicians);

  if (cohort === 'chronic_htn_dm' || cohort === 'lab_worsening' || cohort === 'high_util') {
    const q = 14 + Math.floor(rnd() * 14);
    const start = windowStart.add(20 + Math.floor(rnd() * 40), 'day');
    const startStr = start.format('YYYY-MM-DD');
    const endStr = start.add(28, 'day').format('YYYY-MM-DD');
    records.push(
      buildPrescriptionRecordRnd({
        patient,
        med: metformin,
        record_date: start.toDate(),
        startDate: startStr,
        endDate: endStr,
        provider,
        makeRecordId,
        quantity: q,
        refills: Math.floor(rnd() * 3),
        rnd,
      })
    );
    if (cohort === 'high_util' && rnd() < 0.5) {
      const start2 = start.add(25, 'day');
      const startStr2 = start2.format('YYYY-MM-DD');
      const endStr2 = start2.add(28, 'day').format('YYYY-MM-DD');
      records.push(
        buildPrescriptionRecordRnd({
          patient,
          med: metformin,
          record_date: start2.toDate(),
          startDate: startStr2,
          endDate: endStr2,
          provider: pick(rnd, physicians),
          makeRecordId,
          quantity: q,
          refills: 1,
          rnd,
        })
      );
    }
  }

  if (cohort === 'adherence_gap') {
    const base = windowStart.add(30, 'day');
    const gapDays = 45 + Math.floor(rnd() * 30);
    const w1Start = base.format('YYYY-MM-DD');
    const w1End = base.add(21, 'day').format('YYYY-MM-DD');
    const w2Start = base.add(21 + gapDays, 'day').format('YYYY-MM-DD');
    const w2End = dayjs(w2Start).add(28, 'day').format('YYYY-MM-DD');
    records.push(
      buildPrescriptionRecordRnd({
        patient,
        med: metformin,
        record_date: base.toDate(),
        startDate: w1Start,
        endDate: w1End,
        provider,
        makeRecordId,
        quantity: 28,
        refills: 0,
        rnd,
      })
    );
    records.push(
      buildPrescriptionRecordRnd({
        patient,
        med: metformin,
        record_date: dayjs(w2Start).toDate(),
        startDate: w2Start,
        endDate: w2End,
        provider: pick(rnd, physicians),
        makeRecordId,
        quantity: 28,
        refills: 1,
        rnd,
      })
    );
  }

  if (cohort === 'lab_worsening') {
    const testName = 'Blood glucose';
    const meta = labTestsMetadata[testName];
    // Last 3 > 140 => consecutive Abnormal; ~18% rise across last 3 => Worsening in labTrend.service
    const series = [102, 118, 145, 158, 175];
    const spanDays = windowEnd.diff(windowStart, 'day');
    for (let k = 0; k < series.length; k += 1) {
      const t = windowStart.add(Math.floor((spanDays * (k + 1)) / (series.length + 1)), 'day');
      records.push(
        buildLabRecord(patient, testName, series[k], t.toDate(), pick(rnd, physicians), makeRecordId, meta)
      );
    }
  }

  if (cohort === 'healthy_low_util' || cohort === 'chronic_htn_dm') {
    if (rnd() < 0.7) {
      const testName = pick(rnd, ['CBC', 'Thyroid function']);
      const meta = labTestsMetadata[testName];
      const mid = (meta.normalMin + meta.normalMax) / 2;
      const noise = (meta.normalMax - meta.normalMin) * 0.15;
      const val = mid + (rnd() - 0.5) * noise;
      const t = windowStart.add(Math.floor(rnd() * windowEnd.diff(windowStart, 'day')), 'day');
      records.push(buildLabRecord(patient, testName, val, t.toDate(), pick(rnd, physicians), makeRecordId, meta));
    }
  }

  if (cohort === 'high_util') {
    const testName = 'Cholesterol';
    const meta = labTestsMetadata[testName];
    const t = windowStart.add(Math.floor(rnd() * windowEnd.diff(windowStart, 'day')), 'day');
    const val = meta.normalMin + rnd() * (meta.normalMax - meta.normalMin) * 0.9;
    records.push(buildLabRecord(patient, testName, val, t.toDate(), pick(rnd, physicians), makeRecordId, meta));

    if (rnd() < 0.55) {
      const modality = pick(rnd, IMAGING_MODALITIES);
      const bodyPart = pick(rnd, imagingBodyParts);
      const impression = pick(rnd, imagingImpressions);
      const rad = pick(rnd, physicians);
      const imgDate = windowStart.add(Math.floor(rnd() * windowEnd.diff(windowStart, 'day')), 'day').toDate();
      records.push({
        record_id: makeRecordId(),
        patient_id: patient.patient_id,
        patient_name: `${patient.first_name} ${patient.last_name}`,
        record_type: 'Imaging',
        record_date: imgDate,
        provider: rad,
        save_state: 'final',
        summary: `${modality} of ${bodyPart}`,
        details: {
          title: modality,
          summary: impression,
          imagingStudyType: modality,
          imagingBodyPart: bodyPart,
          imagingFindings: impression,
          imagingImpression: impression,
          imagingFiles: [
            {
              id: `IMG-${makeRecordId()}`,
              name: `${modality}-${bodyPart}-1.jpg`,
              size: 200000 + Math.floor(rnd() * 500000),
            },
          ],
          imagingRadiologist: rad,
        },
        created_by: 'admin',
      });
    }
  }

  if (cohort === 'vaccination_overdue') {
    const vaxDate = windowStart.add(40 + Math.floor(rnd() * 60), 'day');
    const overdueDays = 40 + Math.floor(rnd() * 80);
    const nextDue = dayjs().subtract(overdueDays, 'day').format('YYYY-MM-DD');
    const vName = 'COVID-19';
    const providerV = pick(rnd, physicians);
    records.push({
      record_id: makeRecordId(),
      patient_id: patient.patient_id,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      record_type: 'Vaccination',
      record_date: vaxDate.toDate(),
      provider: providerV,
      save_state: 'final',
      summary: `${vName} vaccination administered`,
      details: {
        title: vName,
        summary: `Series incomplete; next dose overdue.`,
        vaccinationName: vName,
        vaccinationLotNumber: `LOT-${10000 + Math.floor(rnd() * 89999)}`,
        vaccinationExpirationDate: vaxDate.add(400, 'day').format('YYYY-MM-DD'),
        vaccinationSite: pick(rnd, vaccinationSites),
        vaccinationRoute: pick(rnd, vaccinationRoutes),
        vaccinationDoseNumber: '1 of 2',
        vaccinationSeriesComplete: false,
        vaccinationNextDoseDue: nextDue,
        vaccinationVisGiven: true,
        vaccinationAdministeredBy: providerV,
        vaccinationNotes: `Administered ${vName} dose 1. Next dose scheduled.`,
      },
      created_by: 'admin',
    });
  } else if (rnd() < 0.35) {
    const vName = pick(rnd, ['Influenza', 'Tdap', 'Hepatitis B']);
    const vaxDate = windowStart.add(Math.floor(rnd() * windowEnd.diff(windowStart, 'day')), 'day');
    const complete = rnd() > 0.4;
    const providerV = pick(rnd, physicians);
    records.push({
      record_id: makeRecordId(),
      patient_id: patient.patient_id,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      record_type: 'Vaccination',
      record_date: vaxDate.toDate(),
      provider: providerV,
      save_state: 'final',
      summary: `${vName} vaccination`,
      details: {
        title: vName,
        summary: `Vaccination on file.`,
        vaccinationName: vName,
        vaccinationLotNumber: `LOT-${10000 + Math.floor(rnd() * 89999)}`,
        vaccinationExpirationDate: vaxDate.add(365, 'day').format('YYYY-MM-DD'),
        vaccinationSite: pick(rnd, vaccinationSites),
        vaccinationRoute: pick(rnd, vaccinationRoutes),
        vaccinationDoseNumber: '2 of 2',
        vaccinationSeriesComplete: complete,
        vaccinationNextDoseDue: complete ? '' : vaxDate.add(60, 'day').format('YYYY-MM-DD'),
        vaccinationVisGiven: true,
        vaccinationAdministeredBy: providerV,
        vaccinationNotes: `${vName} documented.`,
      },
      created_by: 'admin',
    });
  }

  if (rnd() < 0.25 || cohort === 'high_util') {
    const noteType = pick(rnd, noteTypes);
    const noteContent = pick(rnd, noteTemplates);
    const noteDate = windowStart.add(Math.floor(rnd() * windowEnd.diff(windowStart, 'day')), 'day').toDate();
    records.push({
      record_id: makeRecordId(),
      patient_id: patient.patient_id,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      record_type: 'Note',
      record_date: noteDate,
      provider: pick(rnd, physicians),
      save_state: cohort === 'high_util' && rnd() < 0.08 ? 'draft' : 'final',
      summary: noteContent,
      details: {
        title: noteType,
        summary: noteContent,
        noteType,
        noteContent,
        noteIsAddendum: false,
        previousNote: '',
      },
      created_by: 'admin',
    });
  }

  const invoiceCount = cohort === 'adherence_gap' ? (rnd() < 0.35 ? 1 : 0) : 1 + Math.floor(rnd() * 3);
  for (let inv = 0; inv < invoiceCount; inv += 1) {
    const items = [];
    let totalAmount = 0;
    const nItems = 1 + Math.floor(rnd() * 2);
    for (let j = 0; j < nItems; j += 1) {
      const med = cohort === 'adherence_gap' && j === 0 ? metformin : pick(rnd, medicines);
      const quantity = 10 + Math.floor(rnd() * 15);
      const unitPrice = Number(med.price || 0);
      const totalPrice = quantity * unitPrice;
      totalAmount += totalPrice;
      items.push({
        medicineId: med.id,
        medicineName: med.name,
        prescribedDosage: med.dosage,
        prescribedQuantity: quantity,
        unitPrice,
        totalPrice,
      });
    }
    const invDate = windowStart.add(Math.floor(rnd() * windowEnd.diff(windowStart, 'day')), 'day').toDate();
    invoices.push({
      invoice_id: makeInvoiceId(),
      patient_id: patient.patient_id,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      items,
      total_amount: totalAmount,
      invoice_date: invDate,
      status: pick(rnd, ['pending', 'paid', 'paid', 'cancelled']),
      created_by: 'admin',
    });
  }

  if (cohort === 'chronic_htn_dm' || cohort === 'lab_worsening') {
    const fillDate = windowStart.add(25 + Math.floor(rnd() * 30), 'day').toDate();
    invoices.push({
      invoice_id: makeInvoiceId(),
      patient_id: patient.patient_id,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      items: [
        {
          medicineId: metformin.id,
          medicineName: metformin.name,
          prescribedDosage: metformin.dosage,
          prescribedQuantity: 60,
          unitPrice: Number(metformin.price || 0),
          totalPrice: 60 * Number(metformin.price || 0),
        },
      ],
      total_amount: 60 * Number(metformin.price || 0),
      invoice_date: fillDate,
      status: 'paid',
      created_by: 'admin',
    });
  }

  return { appointments, records, invoices };
}

function finalizePatientStats(patients, records) {
  for (const p of patients) {
    const visits = records.filter((r) => r.patient_id === p.patient_id && r.record_type === 'Visit');
    p.visit_count = visits.length;
    if (visits.length) {
      const latest = visits.reduce((max, v) => {
        const t = new Date(v.record_date).getTime();
        return t > max.t ? { t, d: v.record_date } : max;
      }, { t: 0, d: null });
      p.last_visit_date = latest.d;
    }
    p.attending_physician = p.attending_physician || physicians[0];
  }
}

const seedDatabase = async () => {
  const patientCount = Math.max(8, parseInt(process.env.SEED_PATIENT_COUNT || '60', 10) || 60);
  const seedNum = parseInt(process.env.SEED_RANDOM_SEED || '42', 10) || 42;
  const windowMonths = Math.max(6, parseInt(process.env.SEED_WINDOW_MONTHS || '20', 10) || 20);
  const runPredictive = String(process.env.SEED_RUN_PREDICTIVE || 'true').toLowerCase() !== 'false';

  const rnd = mulberry32(seedNum);
  const windowEnd = dayjs().subtract(1, 'day').endOf('day');
  const windowStart = windowEnd.subtract(windowMonths, 'month').startOf('day');

  const samplePrescriptionPath = path.join(__dirname, '..', 'sample-prescription');
  const medicines = JSON.parse(fs.readFileSync(samplePrescriptionPath, 'utf8'));

  const makeAppointmentId = createIdFactory('APT');
  const makeRecordId = createIdFactory('REC');
  const makeInvoiceId = createIdFactory('INV');

  try {
    console.log('Clearing existing test data...');
    await Patient.deleteMany({});
    await Appointment.deleteMany({});
    await HealthRecord.deleteMany({});
    await PrescriptionInvoice.deleteMany({});
    await PatientRiskProfile.deleteMany({});
    await CareAlert.deleteMany({});
    await LabTrend.deleteMany({});
    await AdherenceRecord.deleteMany({});

    const highRiskCount = Math.max(0, parseInt(process.env.SEED_HIGH_RISK_COUNT || '4', 10) || 0);
    const tierHighPatients = Math.min(highRiskCount, patientCount);
    console.log(
      `Generating cohort data (${patientCount} patients, seed=${seedNum}, window=${windowMonths}mo, risk_tier_high=${tierHighPatients})...`
    );

    const patients = [];
    const allAppointments = [];
    const allRecords = [];
    const allInvoices = [];

    for (let i = 0; i < patientCount; i += 1) {
      let cohort = COHORT_CYCLE[i % COHORT_CYCLE.length];
      if (i < highRiskCount) cohort = 'risk_tier_high';
      const dob = windowStart.subtract(25 + Math.floor(rnd() * 50), 'year').subtract(Math.floor(rnd() * 300), 'day');
      const gRoll = rnd();
      const gender = gRoll < 0.48 ? 'Male' : gRoll < 0.96 ? 'Female' : 'Other';
      const fn = firstNames[Math.floor(rnd() * firstNames.length)];
      const ln = lastNames[Math.floor(rnd() * lastNames.length)];

      const patient = {
        patient_id: generatePatientId(i + 1),
        first_name: fn,
        last_name: ln,
        date_of_birth: dob.toDate(),
        gender,
        contact_number: `+1${String(Math.floor(rnd() * 9000000000) + 1000000000)}`,
        email_address: `${fn.toLowerCase()}.${ln.toLowerCase()}.${i + 1}@example.com`,
        address: addresses[Math.floor(rnd() * addresses.length)],
        national_id: `NAT${String(Math.floor(rnd() * 1e9)).padStart(9, '0')}`,
        status: 'active',
        visit_count: 0,
        attending_physician: physicians[Math.floor(rnd() * physicians.length)],
        created_by: 'admin',
      };
      patients.push(patient);

      const bundle = generatePatientBundle({
        patient,
        cohort,
        rnd,
        windowStart,
        windowEnd,
        medicines,
        makeAppointmentId,
        makeRecordId,
        makeInvoiceId,
      });
      allAppointments.push(...bundle.appointments);
      allRecords.push(...bundle.records);
      allInvoices.push(...bundle.invoices);
    }

    finalizePatientStats(patients, allRecords);

    console.log(`Inserting ${patients.length} patients...`);
    await Patient.insertMany(patients);

    const chunk = async (model, docs, label, size = 800) => {
      for (let i = 0; i < docs.length; i += size) {
        const slice = docs.slice(i, i + size);
        await model.insertMany(slice);
      }
      console.log(`Inserted ${docs.length} ${label}`);
    };

    await chunk(Appointment, allAppointments, 'appointments');
    await chunk(HealthRecord, allRecords, 'health records');
    await chunk(PrescriptionInvoice, allInvoices, 'prescription invoices');

    if (runPredictive) {
      console.log('Running predictive care orchestrator for all active patients...');
      const { computePredictiveCareForAllActivePatients } = require('../src/api/v1/predictive-care/services/predictiveCareOrchestrator.service');
      await computePredictiveCareForAllActivePatients();
      console.log('Predictive care computation finished.');
    } else {
      console.log('Skipped predictive run (SEED_RUN_PREDICTIVE=false). Run: node scripts/batchComputeRiskProfiles.js');
    }

    console.log('Test data generation completed successfully.');
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
};

connectDB().then(() => seedDatabase());
