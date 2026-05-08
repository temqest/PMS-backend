const asyncHandler = require('../../../utils/asyncHandler');
const service = require('./patient.service');
const apiResponse = require('../../../utils/apiResponse');
const logger = require('../../../utils/logger');
const auditService = require('../audit-logs/auditLog.service');

exports.registerPatient = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const patient = await service.registerPatient(req.body, actor);
  apiResponse.success(res, 201, { patient });
});

exports.getPatients = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const result = await service.getPatients(req.query, actor);
  // Audit: list viewed
  logger.info({ event: 'PATIENT_LISTED', actor_id: actor.id, actor_role: actor.role, ip: actor.ip, results: result.results });
  apiResponse.success(res, 200, { patients: result.patients }, { results: result.results, pagination: result.pagination });
});

exports.getPatientById = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const patient = await service.getPatientById(req.params.id, actor);
  logger.info({ event: 'PATIENT_VIEWED', actor_id: actor.id, actor_role: actor.role, ip: actor.ip, patient_id: req.params.id });
  await auditService.logAuditEvent({
    actor,
    action: 'VIEW_PATIENT',
    entity_type: 'patient',
    entity_id: patient.patient_id || req.params.id,
    entity_name: [patient.first_name, patient.last_name].filter(Boolean).join(' ').trim(),
    description: 'Patient profile viewed.',
  });
  apiResponse.success(res, 200, { patient });
});

exports.getCurrentPatient = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const patientId = req.user.patient_id || req.user.sub;
  const patient = await service.getPatientById(patientId, actor);
  logger.info({ event: 'PATIENT_VIEWED_SELF', actor_id: actor.id, actor_role: actor.role, ip: actor.ip, patient_id: patientId });
  await auditService.logAuditEvent({
    actor,
    action: 'VIEW_PATIENT',
    entity_type: 'patient',
    entity_id: patient.patient_id || patientId,
    entity_name: [patient.first_name, patient.last_name].filter(Boolean).join(' ').trim(),
    description: 'Current patient profile viewed.',
  });
  apiResponse.success(res, 200, { patient });
});

exports.updateCurrentPatient = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const patientId = req.user.patient_id || req.user.sub;
  const patient = await service.updatePatient(patientId, req.body, actor);
  logger.info({ event: 'PATIENT_UPDATED_SELF', actor_id: actor.id, actor_role: actor.role, ip: actor.ip, patient_id: patientId });
  apiResponse.success(res, 200, { patient });
});

exports.updatePatient = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const patient = await service.updatePatient(req.params.id, req.body, actor);
  apiResponse.success(res, 200, { patient });
});

exports.softDeletePatient = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const patient = await service.softDeletePatient(req.params.id, actor);
  apiResponse.success(res, 200, { patient });
});

exports.linkAppointment = asyncHandler(async (req, res) => {
  const { appointment_ref } = req.body;
  const actor = auditService.buildActorFromRequest(req);
  const patient = await service.linkAppointment(req.params.id, appointment_ref, actor);
  apiResponse.success(res, 200, { patient });
});

exports.updateMedicalHistory = asyncHandler(async (req, res) => {
  const { medical_history_ref } = req.body;
  const actor = auditService.buildActorFromRequest(req);
  const patient = await service.updateMedicalHistory(req.params.id, medical_history_ref, actor);
  apiResponse.success(res, 200, { patient });
});
