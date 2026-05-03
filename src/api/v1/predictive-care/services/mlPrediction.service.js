const axios = require('axios');

const PatientRiskProfile = require('../models/patientRiskProfile.model');

const ML_SERVICE_URL = (process.env.ML_SERVICE_URL || process.env.ML_SERVICE_INTERNAL_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const ML_TIMEOUT_MS = 10000;

const getMLPredictionsForPatient = async (patient_id) => {
  try {
    const response = await axios.get(`${ML_SERVICE_URL}/predict/full/${patient_id}`, {
      timeout: ML_TIMEOUT_MS,
    });
    return response.data;
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      console.warn(`[ML] Service unavailable, falling back for ${patient_id}`);
      return null;
    }

    console.error('[ML] Unexpected prediction error:', err.message);
    return null;
  }
};

const mergeMLIntoRiskProfile = async (patient_id, ruleBasedProfile) => {
  if (!ruleBasedProfile) {
    return null;
  }

  const ml = await getMLPredictionsForPatient(patient_id);
  if (!ml) {
    return ruleBasedProfile;
  }

  const updates = {};

  if (ml.readmission && !ml.readmission.error) {
    updates.readmission_risk = ml.readmission.readmission_score;
    updates.ml_readmission_prob = ml.readmission.readmission_probability;
    updates.ml_readmission_level = ml.readmission.readmission_risk_level;
  }

  if (ml.chronic_risk && !ml.chronic_risk.error) {
    updates.chronic_disease_risk = ml.chronic_risk.chronic_risk_score;
    updates.ml_chronic_level = ml.chronic_risk.chronic_risk_level;
    updates.ml_chronic_confidence = ml.chronic_risk.confidence;
    updates.ml_top_risk_factors = ml.chronic_risk.top_factors;
  }

  if (ml.anomaly && !ml.anomaly.error) {
    updates.ml_is_anomaly = ml.anomaly.is_anomaly;
    updates.ml_anomaly_score = ml.anomaly.anomaly_score;
  }

  updates.ml_computed_at = new Date();
  updates.ml_service_used = true;

  const newChronicScore =
    updates.chronic_disease_risk ?? ruleBasedProfile.chronic_disease_risk;
  const newReadmissionScore = updates.readmission_risk ?? ruleBasedProfile.readmission_risk;
  const newNoShowScore = ruleBasedProfile.no_show_risk;

  const newOverallScore = Math.round(
    newChronicScore * 0.4 + newReadmissionScore * 0.3 + newNoShowScore * 0.15
  );

  updates.overall_risk_score = newOverallScore;
  updates.overall_risk_level =
    newOverallScore >= 75
      ? 'Critical'
      : newOverallScore >= 50
        ? 'High'
        : newOverallScore >= 25
          ? 'Moderate'
          : 'Low';

  return PatientRiskProfile.findOneAndUpdate(
    { patient_id },
    { $set: updates },
    { new: true }
  );
};

const getLabForecast = async (patient_id, test_name, last_values) => {
  try {
    const response = await axios.post(
      `${ML_SERVICE_URL}/predict/lab-forecast`,
      { patient_id, test_name, last_values },
      { timeout: ML_TIMEOUT_MS }
    );
    return response.data;
  } catch (err) {
    console.warn(`[ML] Lab forecast unavailable for ${test_name}:`, err.message);
    return null;
  }
};

const triggerRetraining = async (models = ['all']) => {
  try {
    const response = await axios.post(
      `${ML_SERVICE_URL}/train`,
      { models },
      { timeout: 120000 }
    );
    return response.data;
  } catch (err) {
    console.error('[ML] Retraining failed:', err.message);
    return null;
  }
};

module.exports = {
  getMLPredictionsForPatient,
  mergeMLIntoRiskProfile,
  getLabForecast,
  triggerRetraining,
};