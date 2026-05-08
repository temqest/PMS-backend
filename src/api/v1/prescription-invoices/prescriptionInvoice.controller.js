const asyncHandler = require('../../../utils/asyncHandler');
const service = require('./prescriptionInvoice.service');
const apiResponse = require('../../../utils/apiResponse');
const auditService = require('../audit-logs/auditLog.service');

exports.getPrescriptionInvoices = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const result = await service.getPrescriptionInvoices(req.query, actor);
  apiResponse.success(res, 200, { invoices: result.invoices }, { results: result.results, pagination: result.pagination });
});

exports.getPrescriptionInvoiceById = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const invoice = await service.getPrescriptionInvoiceById(req.params.id, actor);
  await auditService.logAuditEvent({
    actor,
    action: 'VIEW_PRESCRIPTION_INVOICE',
    entity_type: 'prescription_invoice',
    entity_id: invoice.invoice_id,
    entity_name: invoice.patient_name,
    description: 'Prescription invoice viewed.',
  });
  apiResponse.success(res, 200, { invoice });
});

exports.updatePrescriptionInvoiceStatus = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const invoice = await service.updatePrescriptionInvoiceStatus(req.params.id, req.body, actor);
  apiResponse.success(res, 200, { invoice });
});

exports.createPrescriptionInvoice = asyncHandler(async (req, res) => {
  const actor = auditService.buildActorFromRequest(req);
  const invoice = await service.createPrescriptionInvoice(req.body, actor);
  apiResponse.success(res, 201, { invoice });
});
