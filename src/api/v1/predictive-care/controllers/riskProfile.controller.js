const asyncHandler = require('../../../../utils/asyncHandler');
const apiResponse = require('../../../../utils/apiResponse');
const logger = require('../../../../utils/logger');
const AppError = require('../../../../utils/AppError');
const PatientRiskProfile = require('../models/patientRiskProfile.model');
const Patient = require('../../patients/patient.model');
const {
  computePredictiveCareForPatient,
  computePredictiveCareForAllActivePatients,
} = require('../services/predictiveCareOrchestrator.service');
const {
  triggerRetraining,
  getLabForecast,
  getMlServiceStatus,
} = require('../services/mlPrediction.service');
const { PREDICTIVE_CARE_DISCLAIMER } = require('../../../../config/predictiveCare');
const {
  ensurePatientOwnsParam,
  rejectPatientAccess,
} = require('../predictiveCare.access');

exports.getPatientRiskProfile = asyncHandler(async (req, res) => {
  ensurePatientOwnsParam(req);
  const profile = await PatientRiskProfile.findOne({ patient_id: req.params.patientId });
  if (!profile) {
    throw new AppError('Risk profile not yet computed for this patient.', 404);
  }
  apiResponse.success(res, 200, {
    profile,
    predictive_care_disclaimer: PREDICTIVE_CARE_DISCLAIMER,
  });
});

exports.getAllRiskProfiles = asyncHandler(async (req, res) => {
  rejectPatientAccess(req);
  const limit = parseInt(req.query.limit, 10) || 20;
  const page = parseInt(req.query.page, 10) || 1;
  const { risk_level: riskLevel } = req.query;
  const filter = riskLevel ? { overall_risk_level: riskLevel } : {};

  const [profiles, total] = await Promise.all([
    PatientRiskProfile.find(filter)
      .sort({ overall_risk_score: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    PatientRiskProfile.countDocuments(filter),
  ]);

  apiResponse.success(res, 200, { profiles }, { total, page, limit });
});

exports.computeForPatient = asyncHandler(async (req, res) => {
  const patient = await Patient.findOne({ patient_id: req.params.patientId });
  if (!patient) {
    throw new AppError('Patient not found.', 404);
  }

  await computePredictiveCareForPatient(patient);
  const profile = await PatientRiskProfile.findOne({ patient_id: patient.patient_id });
  apiResponse.success(res, 200, {
    message: 'Risk profile computed successfully.',
    profile,
    predictive_care_disclaimer: PREDICTIVE_CARE_DISCLAIMER,
  });
});

exports.computeForAll = asyncHandler(async (req, res) => {
  apiResponse.success(res, 200, {
    message: 'Computation started for all active patients.',
  });

  void computePredictiveCareForAllActivePatients().catch((err) => {
    logger.error({ event: 'PREDICTIVE_CARE_BATCH_FAILED', error: err.message, stack: err.stack });
  });
});

exports.retrainModels = asyncHandler(async (req, res) => {
  const result = await triggerRetraining(req.body.models || ['all']);
  apiResponse.success(res, 200, result || { message: 'Retrain triggered (or ML service unavailable)' });
});

exports.mlStatus = asyncHandler(async (req, res) => {
  rejectPatientAccess(req);
  const status = await getMlServiceStatus();
  apiResponse.success(res, 200, status);
});

exports.labForecast = asyncHandler(async (req, res) => {
  ensurePatientOwnsParam(req);
  const { test_name: testName, last_values: lastValues } = req.query;
  const parsed = lastValues ? String(lastValues).split(',').map(Number) : [];

  const result = await getLabForecast(req.params.patientId, testName, parsed);
  if (!result) {
    throw new AppError('ML service unavailable', 503);
  }

  apiResponse.success(res, 200, result);
});
