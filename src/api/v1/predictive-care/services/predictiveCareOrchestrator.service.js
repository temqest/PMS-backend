const Patient = require('../../patients/patient.model');
const PatientRiskProfile = require('../models/patientRiskProfile.model');
const { computeLabTrendsForPatient } = require('./labTrend.service');
const { computeRiskProfileForPatient } = require('./riskScore.service');
const { checkVaccinationGapsForPatient } = require('./vaccinationGap.service');
const { computeAdherenceForPatient } = require('./adherence.service');
const { mergeMLIntoRiskProfile } = require('./mlPrediction.service');

const patientDisplayName = (patient) =>
  `${patient.first_name || ''} ${patient.last_name || ''}`.trim();

/**
 * Runs lab trends, vaccination checks, adherence, then risk profile (needs adherence scores in DB).
 */
const computePredictiveCareForPatient = async (patient) => {
  const name = patientDisplayName(patient);
  await Promise.all([
    computeLabTrendsForPatient(patient.patient_id, name),
    checkVaccinationGapsForPatient(patient.patient_id, name),
    computeAdherenceForPatient(patient.patient_id, name),
  ]);
  await computeRiskProfileForPatient(patient);
  const ruleBased = await PatientRiskProfile.findOne({ patient_id: patient.patient_id });
  if (ruleBased) {
    await mergeMLIntoRiskProfile(patient.patient_id, ruleBased);
  }
};

const computePredictiveCareForAllActivePatients = async () => {
  const patients = await Patient.find({ status: 'active' });
  for (const patient of patients) {
    await computePredictiveCareForPatient(patient);
  }
};

module.exports = {
  computePredictiveCareForPatient,
  computePredictiveCareForAllActivePatients,
};
