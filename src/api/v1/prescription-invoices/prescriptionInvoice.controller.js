const asyncHandler = require('../../../utils/asyncHandler');
const service = require('./prescriptionInvoice.service');
const apiResponse = require('../../../utils/apiResponse');

exports.getPrescriptionInvoices = asyncHandler(async (req, res) => {
  const result = await service.getPrescriptionInvoices(req.query);
  apiResponse.success(res, 200, { invoices: result.invoices }, { results: result.results, pagination: result.pagination });
});

exports.getPrescriptionInvoiceById = asyncHandler(async (req, res) => {
  const invoice = await service.getPrescriptionInvoiceById(req.params.id);
  apiResponse.success(res, 200, { invoice });
});

exports.updatePrescriptionInvoiceStatus = asyncHandler(async (req, res) => {
  const actor = { id: req.apiKey?.createdBy, role: 'api_key', ip: req.ip };
  const invoice = await service.updatePrescriptionInvoiceStatus(req.params.id, req.body.status, actor);
  apiResponse.success(res, 200, { invoice });
});

exports.createPrescriptionInvoice = asyncHandler(async (req, res) => {
  const actor = { id: req.user?.sub, role: req.user?.role, ip: req.ip };
  const invoice = await service.createPrescriptionInvoice(req.body, actor);
  apiResponse.success(res, 201, { invoice });
});
