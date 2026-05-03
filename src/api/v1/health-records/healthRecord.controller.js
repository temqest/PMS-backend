const asyncHandler = require('../../../utils/asyncHandler');
const service = require('./healthRecord.service');
const apiResponse = require('../../../utils/apiResponse');

exports.getHealthRecords = asyncHandler(async (req, res) => {
  const result = await service.getHealthRecords(req.query);
  apiResponse.success(res, 200, { records: result.records }, { results: result.results, pagination: result.pagination });
});

exports.getHealthRecordById = asyncHandler(async (req, res) => {
  const record = await service.getHealthRecordById(req.params.id);
  apiResponse.success(res, 200, { record });
});

exports.getPrescriptionMedicines = asyncHandler(async (req, res) => {
  const medicines = await service.getPrescriptionMedicines();
  apiResponse.success(res, 200, { data: medicines });
});

exports.createHealthRecord = asyncHandler(async (req, res) => {
  const actor = { id: req.user?.sub, role: req.user?.role, ip: req.ip };
  const record = await service.createHealthRecord(req.body, actor);
  apiResponse.success(res, 201, { record });
});

exports.updateHealthRecord = asyncHandler(async (req, res) => {
  const actor = { id: req.user?.sub, role: req.user?.role, ip: req.ip };
  const record = await service.updateHealthRecord(req.params.id, req.body, actor);
  apiResponse.success(res, 200, { record });
});

exports.deleteHealthRecord = asyncHandler(async (req, res) => {
  const actor = { id: req.user?.sub, role: req.user?.role, ip: req.ip };
  const record = await service.deleteHealthRecord(req.params.id, actor);
  apiResponse.success(res, 200, { record });
});
