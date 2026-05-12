const PrescriptionInvoice = require('./prescriptionInvoice.model');
const Patient = require('../patients/patient.model');
const AppError = require('../../../utils/AppError');
const logger = require('../../../utils/logger');
const auditService = require('../audit-logs/auditLog.service');

const makeInvoiceId = () =>
  `INV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const getTotalAmount = (items = []) =>
  items.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);

const getCanonicalPatientName = (patient) =>
  [patient?.first_name, patient?.last_name].filter(Boolean).join(' ').trim();

exports.getPrescriptionInvoices = async (query = {}, actor = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.max(1, parseInt(query.limit, 10) || 20);
  const skip = (page - 1) * limit;

  const filter = {};
  if (actor.role === 'patient' && actor.patient_id) {
    filter.patient_id = actor.patient_id;
  } else if (query.patient_id) {
    filter.patient_id = query.patient_id;
  }
  if (query.health_record_id) filter.health_record_id = query.health_record_id;
  if (query.invoice_id) filter.invoice_id = query.invoice_id;
  if (query.status) filter.status = query.status;
  if (query.search) {
    const q = new RegExp(query.search, 'i');
    filter.$or = [{ patient_name: q }, { invoice_id: q }];
  }

  const [total, invoices] = await Promise.all([
    PrescriptionInvoice.countDocuments(filter),
    PrescriptionInvoice.find(filter).sort({ invoice_date: -1 }).skip(skip).limit(limit),
  ]);

  return {
    results: invoices.length,
    invoices,
    pagination: { total, page, pages: Math.ceil(total / limit) || 1, limit },
  };
};

exports.getPrescriptionInvoiceById = async (invoiceId, actor = {}) => {
  const invoice = await PrescriptionInvoice.findOne({ invoice_id: invoiceId });
  if (!invoice) throw new AppError('Prescription invoice not found.', 404);
  if (actor.role === 'patient' && actor.patient_id && invoice.patient_id !== actor.patient_id) {
    throw new AppError('Forbidden: cannot access another patient invoice.', 403);
  }
  return invoice;
};

exports.updatePrescriptionInvoiceStatus = async (invoiceId, updates, actor) => {
  const invoice = await PrescriptionInvoice.findOne({ invoice_id: invoiceId });
  if (!invoice) throw new AppError('Prescription invoice not found.', 404);
  const before = invoice.toObject({ versionKey: false });

  if (typeof updates.status === 'string') {
    invoice.status = updates.status;
  }
  if (typeof updates.is_released === 'boolean') {
    invoice.is_released = updates.is_released;
  }
  invoice.updated_by = actor?.id;
  await invoice.save();

  logger.info({
    event: 'PRESCRIPTION_INVOICE_STATUS_UPDATED',
    actor_id: actor?.id,
    actor_role: actor?.role,
    ip: actor?.ip,
    invoice_id: invoice.invoice_id,
    status: invoice.status,
    is_released: invoice.is_released,
  });

  const diff = auditService.diffValues(before, invoice);
  await auditService.logAuditEvent({
    actor,
    action: 'UPDATE_PRESCRIPTION_INVOICE_STATUS',
    entity_type: 'prescription_invoice',
    entity_id: invoice.invoice_id,
    entity_name: invoice.patient_name,
    description: 'Prescription invoice status updated.',
    old_value: diff.old_value,
    new_value: diff.new_value,
  });

  return invoice;
};

exports.createPrescriptionInvoice = async (data, actor) => {
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) {
    throw new AppError('Invoice must include at least one item.', 422);
  }

  const totalAmount = Number(data.total_amount);
  if (Number.isNaN(totalAmount) || totalAmount < 0) {
    throw new AppError('Invoice total amount is invalid.', 422);
  }

  const patientId = String(data.patient_id || '').trim();
  if (!patientId) {
    throw new AppError('patient_id is required.', 422);
  }
  const patient = await Patient.findOne({ patient_id: patientId });
  if (!patient) {
    throw new AppError('Patient not found.', 404);
  }
  const patientName = getCanonicalPatientName(patient);

  const invoice = await PrescriptionInvoice.create({
    invoice_id: makeInvoiceId(),
    patient_id: patientId,
    patient_name: patientName,
    health_record_id: data.health_record_id || '',
    items,
    prescription_names: items.map((item) => String(item.medicineName || '').trim()).filter(Boolean),
    // include optional variable and release flag
    variable: data.variable ?? null,
    is_released: Boolean(data.is_released || false),
    total_amount: totalAmount,
    invoice_date: data.invoice_date ? new Date(data.invoice_date) : new Date(),
    status: data.status || 'pending',
    created_by: actor?.id,
  });

  if (data.patient_id) {
    Patient.findOneAndUpdate(
      { patient_id: data.patient_id },
      { $addToSet: { billing_refs: invoice.invoice_id }, $set: { updated_by: actor?.id } }
    ).catch(() => undefined);
  }

  logger.info({
    event: 'PRESCRIPTION_INVOICE_CREATED',
    actor_id: actor?.id,
    actor_role: actor?.role,
    ip: actor?.ip,
    invoice_id: invoice.invoice_id,
    patient_id: invoice.patient_id,
    health_record_id: invoice.health_record_id,
    total_amount: invoice.total_amount,
  });

  await auditService.logAuditEvent({
    actor,
    action: 'CREATE_PRESCRIPTION_INVOICE',
    entity_type: 'prescription_invoice',
    entity_id: invoice.invoice_id,
    entity_name: invoice.patient_name,
    description: 'Prescription invoice created.',
    new_value: invoice,
  });

  return invoice;
};

exports.createInvoiceForHealthRecord = async (healthRecord, actor) => {
  if (!healthRecord || healthRecord.record_type !== 'Prescription') {
    return null;
  }

  const details = healthRecord.details || {};
  const items = Array.isArray(details.medicines) ? details.medicines : [];
  if (!items.length) {
    throw new AppError('Cannot create invoice: prescription contains no items.', 422);
  }

  const totalAmount = getTotalAmount(items);

  return exports.createPrescriptionInvoice(
    {
      patient_id: healthRecord.patient_id,
      patient_name: healthRecord.patient_name,
      health_record_id: healthRecord.record_id,
      items,
      total_amount: totalAmount,
      invoice_date: new Date().toISOString(),
      status: 'pending',
    },
    actor
  );
};
