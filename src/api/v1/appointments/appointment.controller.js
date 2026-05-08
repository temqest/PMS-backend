const asyncHandler = require('../../../utils/asyncHandler');
const service = require('./appointment.service');
const apiResponse = require('../../../utils/apiResponse');
const auditService = require('../audit-logs/auditLog.service');

exports.getAppointments = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const result = await service.getAppointments(req.query, actor);
  apiResponse.success(res, 200, { appointments: result.appointments }, { results: result.results, pagination: result.pagination });
});

exports.getMyAppointments = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const result = await service.getAppointments({ ...req.query, patient_id: req.user?.patient_id }, actor);
  apiResponse.success(res, 200, { appointments: result.appointments }, { results: result.results, pagination: result.pagination });
});

exports.createAppointment = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const appointment = await service.createAppointment(req.body, actor);
  apiResponse.success(res, 201, { appointment });
});

exports.updateAppointment = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const appointment = await service.updateAppointment(req.params.id, req.body, actor);
  apiResponse.success(res, 200, { appointment });
});

exports.cancelAppointment = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const appointment = await service.cancelAppointment(req.params.id, req.body.reason, actor);
  apiResponse.success(res, 200, { appointment });
});
