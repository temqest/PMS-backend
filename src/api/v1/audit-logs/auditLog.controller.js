const mongoose = require('mongoose');

const asyncHandler = require('../../../utils/asyncHandler');
const apiResponse = require('../../../utils/apiResponse');
const AppError = require('../../../utils/AppError');
const AuditLog = require('./auditLog.model');
const auditService = require('./auditLog.service');
const Appointment = require('../appointments/appointment.model');

exports.getAuditLogs = asyncHandler(async (req, res) => {
  const result = await auditService.getAuditLogs(req.query);
  apiResponse.success(
    res,
    200,
    { audit_logs: result.auditLogs },
    { results: result.results, pagination: result.pagination }
  );
});

exports.getAuditLogById = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw new AppError('Audit log not found.', 404);
  }

  const auditLog = await AuditLog.findById(req.params.id);
  if (!auditLog) throw new AppError('Audit log not found.', 404);

  apiResponse.success(res, 200, { audit_log: auditLog });
});

exports.recordTelehealthEvent = asyncHandler(async (req, res) => {
  const { action, action_type: actionType, appointment_id: appointmentId, description } = req.body || {};
  const resolvedActionType = actionType || action;
  const telehealthActionMap = {
    START_TELEHEALTH_CALL: 'TELEHEALTH_STARTED',
    END_TELEHEALTH_CALL: 'TELEHEALTH_ENDED',
    TELEHEALTH_STARTED: 'TELEHEALTH_STARTED',
    TELEHEALTH_ENDED: 'TELEHEALTH_ENDED',
  };
  const auditActionType = telehealthActionMap[resolvedActionType] || resolvedActionType;
  const actor = auditService.buildActorFromRequest(req);
  const appointment = await Appointment.findOne({ appointment_id: appointmentId });
  if (!appointment) throw new AppError('Appointment not found.', 404);

  if (actor.role === 'patient' && (!actor.patient_id || appointment.patient_id !== actor.patient_id)) {
    throw new AppError('Forbidden: cannot audit another patient telehealth appointment.', 403);
  }

  await auditService.logAuditEvent({
    actor,
    action_type: auditActionType,
    subsystem: 'Appointment',
    details: description || `${auditActionType === 'TELEHEALTH_STARTED' ? 'Started' : 'Ended'} telehealth call for appointment ${appointment.appointment_id} (${appointment.patient_name})`,
  });

  apiResponse.success(res, 201, { recorded: true });
});
