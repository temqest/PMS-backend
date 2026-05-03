const dayjs = require('dayjs');
const HealthRecord = require('../../health-records/healthRecord.model');
const Appointment = require('../../appointments/appointment.model');
const PatientRiskProfile = require('../models/patientRiskProfile.model');
const CareAlert = require('../models/careAlert.model');
const AdherenceRecord = require('../models/adherenceRecord.model');

const HIGH_RISK_DIAGNOSES = [
  'hypertension',
  'type 2 diabetes',
  'chronic',
  'heart failure',
  'copd',
  'obesity',
  'renal',
  'kidney',
  'coronary',
];

async function adherenceRiskScore(patient_id) {
  const records = await AdherenceRecord.find({ patient_id });
  if (!records.length) return 0;
  const avgScore =
    records.reduce((sum, r) => sum + (r.adherence_score != null ? r.adherence_score : 100), 0) /
    records.length;
  return Math.min(100, Math.round(100 - avgScore));
}

const computeNoShowScore = (appointments) => {
  const now = new Date();
  const past = appointments.filter((a) => a.scheduled_at && new Date(a.scheduled_at) < now);
  if (!past.length) return 0;
  const missed = past.filter((a) => a.status !== 'Completed').length;
  return Math.min(100, Math.round((missed / past.length) * 100));
};

const computeChronicDiseaseScore = (visitRecords, labRecords) => {
  let score = 0;

  const diagnoses = visitRecords.map((r) => (r.details?.visitAssessment || '').toLowerCase());
  for (const d of diagnoses) {
    for (const keyword of HIGH_RISK_DIAGNOSES) {
      if (d.includes(keyword)) {
        score += 10;
        break;
      }
    }
  }

  const abnormalLabs = labRecords.filter((r) => r.details?.labStatus && r.details.labStatus !== 'Normal');
  score += abnormalLabs.length * 8;

  const highBpVisits = visitRecords.filter((r) => {
    const systolic = parseInt(String(r.details?.visitBpSystolic || '0'), 10);
    return systolic >= 140;
  });
  score += highBpVisits.length * 6;

  return Math.min(score, 100);
};

const computeReadmissionScore = (visitRecords) => {
  const cutoff = dayjs().subtract(90, 'day').toDate();
  const recentUrgent = visitRecords.filter(
    (r) =>
      new Date(r.record_date) >= cutoff &&
      (r.details?.visitType === 'Urgent' || r.details?.visitType === 'Follow-up')
  );
  return Math.min(recentUrgent.length * 20, 100);
};

const computeRiskProfileForPatient = async (patient) => {
  const { patient_id, first_name, last_name } = patient;
  const patient_name = `${first_name} ${last_name}`;

  const [visitRecords, labRecords, appointments, allRecords, adherenceRisk] = await Promise.all([
    HealthRecord.find({ patient_id, record_type: 'Visit', save_state: 'final' }).sort({
      record_date: -1,
    }),
    HealthRecord.find({ patient_id, record_type: 'Lab Result', save_state: 'final' }).sort({
      record_date: -1,
    }),
    Appointment.find({ patient_id }).sort({ scheduled_at: -1 }),
    HealthRecord.countDocuments({ patient_id }),
    adherenceRiskScore(patient_id),
  ]);

  const chronicScore = computeChronicDiseaseScore(visitRecords, labRecords);
  const readmissionScore = computeReadmissionScore(visitRecords);
  const noShowScore = computeNoShowScore(appointments);
  const hasCriticalLabs = labRecords.some((r) => r.details?.labStatus === 'Critical');

  const overallScore = Math.round(
    chronicScore * 0.35 + readmissionScore * 0.25 + noShowScore * 0.15 + adherenceRisk * 0.25
  );

  const riskLevel =
    overallScore >= 75 ? 'Critical' : overallScore >= 50 ? 'High' : overallScore >= 25 ? 'Moderate' : 'Low';

  const profile = await PatientRiskProfile.findOneAndUpdate(
    { patient_id },
    {
      patient_id,
      patient_name,
      overall_risk_score: overallScore,
      overall_risk_level: riskLevel,
      chronic_disease_risk: chronicScore,
      readmission_risk: readmissionScore,
      no_show_risk: noShowScore,
      adherence_risk: adherenceRisk,
      has_critical_labs: hasCriticalLabs,
      last_computed_at: new Date(),
      record_count_at_last_compute: allRecords,
    },
    { upsert: true, new: true }
  );

  if (overallScore >= 50) {
    await CareAlert.findOneAndUpdate(
      { patient_id, alert_type: 'CHRONIC_RISK', is_resolved: false },
      {
        patient_id,
        patient_name,
        alert_type: 'CHRONIC_RISK',
        severity: riskLevel === 'Critical' ? 'Critical' : 'Warning',
        title: `${riskLevel} chronic disease risk`,
        message: `Patient has a risk score of ${overallScore}/100 based on vitals, diagnoses, and visit history.`,
        metadata: {
          overall_score: overallScore,
          chronic_score: chronicScore,
          readmission_score: readmissionScore,
        },
        triggered_at: new Date(),
      },
      { upsert: true, new: true }
    );
  }

  return profile;
};

const computeAllPatientRiskProfiles = async () => {
  const Patient = require('../../patients/patient.model');
  const patients = await Patient.find({ status: 'active' });
  for (const patient of patients) {
    await computeRiskProfileForPatient(patient);
  }
};

module.exports = {
  computeRiskProfileForPatient,
  computeAllPatientRiskProfiles,
};
