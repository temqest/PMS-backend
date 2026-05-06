const axios = require('axios');

const PatientRiskProfile = require('../models/patientRiskProfile.model');
const { overallRiskScore, overallRiskLevel } = require('./predictiveCareScoring');

const ML_LABEL_DEFINITION =
  '90-day proxy: likelihood of an Urgent or Follow-up visit after an index visit (no hospitalization feed; decision support only).';

const buildMlExplanation = (features, topFactors) => {
  if (!features || typeof features !== 'object' || !Array.isArray(topFactors)) {
    return [];
  }
  return topFactors
    .filter((row) => row && typeof row.feature === 'string')
    .slice(0, 7)
    .map((row) => {
      const key = row.feature;
      const raw = features[key];
      let resolved_value = raw;
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        resolved_value = raw;
      } else if (raw != null && raw !== '' && !Number.isNaN(Number(raw))) {
        resolved_value = Number(raw);
      }
      return {
        feature: key,
        importance: typeof row.importance === 'number' ? row.importance : Number(row.importance) || 0,
        resolved_value,
      };
    });
};

const ML_TIMEOUT_MS = 10000;

const configuredMlServiceUrls = () => {
  const raw = [
    process.env.ML_SERVICE_INTERNAL_URL,
    process.env.ML_SERVICE_URL,
  ];

  return [...new Set(raw
    .map((value) => (typeof value === 'string' ? value.trim().replace(/\/$/, '') : ''))
    .filter(Boolean))];
};

const isTransientMlFailure = (err) => {
  const status = err?.response?.status;
  return (
    err?.code === 'ECONNREFUSED' ||
    err?.code === 'ETIMEDOUT' ||
    status === 404 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
};

const callMlService = async (requestFactory) => {
  const urls = configuredMlServiceUrls();
  let lastError = null;

  for (const baseUrl of urls) {
    try {
      const response = await requestFactory(baseUrl);
      return { data: response.data, baseUrl };
    } catch (err) {
      lastError = err;
      if (!isTransientMlFailure(err)) {
        throw err;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error('No ML service URLs configured');
};

const getMLPredictionsForPatient = async (patient_id) => {
  try {
    const result = await callMlService((baseUrl) =>
      axios.get(`${baseUrl}/predict/full/${patient_id}`, {
        timeout: ML_TIMEOUT_MS,
      })
    );
    return result.data;
  } catch (err) {
    if (err?.response?.status === 404) {
      console.warn(`[ML] Prediction endpoint returned 404 for ${patient_id}; skipping ML enrichment`);
      return null;
    }

    if (isTransientMlFailure(err)) {
      const status = err?.response?.status ? `HTTP ${err.response.status}` : err.code;
      console.warn(`[ML] Prediction unavailable for ${patient_id} (${status}); falling back`);
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
  updates.ml_label_definition = ML_LABEL_DEFINITION;

  if (ml.features && typeof ml.features === 'object') {
    const snap = { ...ml.features };
    if (typeof snap.feature_version !== 'undefined') {
      updates.ml_feature_version =
        typeof snap.feature_version === 'string' ? snap.feature_version : String(snap.feature_version);
      delete snap.feature_version;
    }
    updates.ml_last_feature_snapshot = snap;
    updates.ml_explanation = buildMlExplanation(
      ml.features,
      ml.chronic_risk && !ml.chronic_risk.error ? ml.chronic_risk.top_factors : []
    );
  }

  const newChronicScore = ruleBasedProfile.chronic_disease_risk;
  const newReadmissionScore = updates.readmission_risk ?? ruleBasedProfile.readmission_risk;
  const newNoShowScore = ruleBasedProfile.no_show_risk;
  const adherence = ruleBasedProfile.adherence_risk ?? 0;

  const newOverallScore = overallRiskScore(
    newChronicScore,
    newReadmissionScore,
    newNoShowScore,
    adherence
  );

  updates.overall_risk_score = newOverallScore;
  updates.overall_risk_level = overallRiskLevel(newOverallScore);

  return PatientRiskProfile.findOneAndUpdate(
    { patient_id },
    { $set: updates },
    { returnDocument: 'after' }
  );
};

const getLabForecast = async (patient_id, test_name, last_values) => {
  try {
    const result = await callMlService((baseUrl) =>
      axios.post(
        `${baseUrl}/predict/lab-forecast`,
        { patient_id, test_name, last_values },
        { timeout: ML_TIMEOUT_MS }
      )
    );
    return result.data;
  } catch (err) {
    console.warn(`[ML] Lab forecast unavailable for ${test_name}:`, err.message);
    return null;
  }
};

const triggerRetraining = async (models = ['all']) => {
  try {
    const result = await callMlService((baseUrl) =>
      axios.post(
        `${baseUrl}/train`,
        { models },
        { timeout: 120000 }
      )
    );
    return result.data;
  } catch (err) {
    console.error('[ML] Retraining failed:', err.message);
    return null;
  }
};

const getMlServiceStatus = async () => {
  const urls = configuredMlServiceUrls();

  for (const baseUrl of urls) {
    try {
      const response = await axios.get(`${baseUrl}/health`, {
        timeout: Math.min(ML_TIMEOUT_MS, 5000),
      });

      return {
        configured_urls: urls,
        active_url: baseUrl,
        reachable: true,
        health: response.data,
      };
    } catch (err) {
      if (!isTransientMlFailure(err)) {
        return {
          configured_urls: urls,
          active_url: baseUrl,
          reachable: false,
          error: err.message,
        };
      }
    }
  }

  return {
    configured_urls: urls,
    active_url: null,
    reachable: false,
    error: 'No configured ML service responded to /health',
  };
};

module.exports = {
  configuredMlServiceUrls,
  getMLPredictionsForPatient,
  getMlServiceStatus,
  mergeMLIntoRiskProfile,
  getLabForecast,
  triggerRetraining,
};
