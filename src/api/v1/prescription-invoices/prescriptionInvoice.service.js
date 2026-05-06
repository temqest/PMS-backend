const PrescriptionInvoice = require('./prescriptionInvoice.model');
const Patient = require('../patients/patient.model');
const AppError = require('../../../utils/AppError');
const logger = require('../../../utils/logger');

const makeInvoiceId = () =>
  `INV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const getTotalAmount = (items = []) =>
  items.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);

exports.getPrescriptionInvoices = async (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.max(1, parseInt(query.limit, 10) || 20);
  const skip = (page - 1) * limit;

  const filter = {};
  if (query.patient_id) filter.patient_id = query.patient_id;
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

exports.getPrescriptionInvoiceById = async (invoiceId) => {
  const invoice = await PrescriptionInvoice.findOne({ invoice_id: invoiceId });
  if (!invoice) throw new AppError('Prescription invoice not found.', 404);
  return invoice;
};

exports.updatePrescriptionInvoiceStatus = async (invoiceId, updates, actor) => {
  const invoice = await PrescriptionInvoice.findOne({ invoice_id: invoiceId });
  if (!invoice) throw new AppError('Prescription invoice not found.', 404);

  const nextStatus = typeof updates.status === 'string' ? updates.status : invoice.status;
  let nextIsReleased =
    typeof updates.is_released === 'boolean' ? updates.is_released : invoice.is_released;

  if (updates.status === 'paid') {
    nextIsReleased = true;
  }

  if (nextIsReleased && nextStatus !== 'paid') {
    throw new AppError('is_released can only be true when status is paid.', 422);
  }

  if (nextStatus !== 'paid') {
    nextIsReleased = false;
  }

  invoice.status = nextStatus;
  invoice.is_released = nextIsReleased;
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

  const invoice = await PrescriptionInvoice.create({
    invoice_id: makeInvoiceId(),
    patient_id: data.patient_id,
    patient_name: data.patient_name,
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
