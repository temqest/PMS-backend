const asyncHandler = require('../../../../utils/asyncHandler');
const apiResponse = require('../../../../utils/apiResponse');
const AppError = require('../../../../utils/AppError');
const {
  getDashboardSummary,
  getLabTrendChartData,
  getPatientRiskRadar,
  getPatientAdherenceChartData,
  getPatientAlertTimeline,
} = require('../services/analytics.service');

exports.dashboardSummary = asyncHandler(async (req, res) => {
  const data = await getDashboardSummary();
  apiResponse.success(res, 200, data);
});

exports.labTrendChart = asyncHandler(async (req, res) => {
  const data = await getLabTrendChartData(req.params.patientId);
  apiResponse.success(res, 200, { trends: data });
});

exports.riskRadar = asyncHandler(async (req, res) => {
  const data = await getPatientRiskRadar(req.params.patientId);
  if (!data) {
    throw new AppError('No risk profile found.', 404);
  }
  apiResponse.success(res, 200, data);
});

exports.adherenceChart = asyncHandler(async (req, res) => {
  const data = await getPatientAdherenceChartData(req.params.patientId);
  apiResponse.success(res, 200, { adherence: data });
});

exports.alertTimeline = asyncHandler(async (req, res) => {
  const data = await getPatientAlertTimeline(req.params.patientId);
  apiResponse.success(res, 200, { timeline: data });
});
