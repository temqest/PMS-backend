const asyncHandler = require('../../../utils/asyncHandler');
const service = require('./healthRecord.service');
const apiResponse = require('../../../utils/apiResponse');
const auditService = require('../audit-logs/auditLog.service');

exports.getHealthRecords = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const result = await service.getHealthRecords(req.query, actor);
  apiResponse.success(res, 200, { records: result.records }, { results: result.results, pagination: result.pagination });
});

exports.getMyHealthRecords = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const result = await service.getHealthRecords({ ...req.query, patient_id: req.user?.patient_id }, actor);
  apiResponse.success(res, 200, { records: result.records }, { results: result.results, pagination: result.pagination });
});

exports.getHealthRecordById = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const record = await service.getHealthRecordById(req.params.id, actor);
  const isPrescription = record.record_type === 'Prescription';
  await auditService.logAuditEvent({
    actor,
    action: isPrescription ? 'VIEW_PRESCRIPTION' : 'VIEW_HEALTH_RECORD',
    entity_type: isPrescription ? 'prescription' : 'health_record',
    entity_id: record.record_id,
    entity_name: record.patient_name,
    description: `${isPrescription ? 'Prescription' : 'Health record'} viewed.`,
  });
  apiResponse.success(res, 200, { record });
});

exports.getPrescriptionMedicines = asyncHandler(async (req, res) => {
  const medicines = await service.getPrescriptionMedicines();
  apiResponse.success(res, 200, { data: medicines });
});

exports.createHealthRecord = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const record = await service.createHealthRecord(req.body, actor);
  apiResponse.success(res, 201, { record });
});

exports.updateHealthRecord = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const record = await service.updateHealthRecord(req.params.id, req.body, actor);
  apiResponse.success(res, 200, { record });
});

exports.deleteHealthRecord = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const record = await service.deleteHealthRecord(req.params.id, actor);
  apiResponse.success(res, 200, { record });
});
