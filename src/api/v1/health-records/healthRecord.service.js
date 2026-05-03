const HealthRecord = require('./healthRecord.model');
const invoiceService = require('../prescription-invoices/prescriptionInvoice.service');
const AppError = require('../../../utils/AppError');
const logger = require('../../../utils/logger');

const INVENTORY_CACHE_TTL = 60 * 1000;
let prescriptionInventoryCache = { timestamp: 0, items: [] };

const fetchPrescriptionInventory = async () => {
  const url = process.env.PRESCRIPTION_API_URL;
  if (!url) {
    throw new AppError('Prescription inventory URL is not configured.', 500);
  }

  const now = Date.now();
  if (now - prescriptionInventoryCache.timestamp < INVENTORY_CACHE_TTL) {
    return prescriptionInventoryCache.items;
  }

  const httpFetch = typeof fetch !== 'undefined' ? fetch : null;
  if (!httpFetch) {
    throw new AppError('Server fetch API is unavailable. Please run on Node 18+ or install a fetch polyfill.', 500);
  }

  const response = await httpFetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new AppError(`Failed to load prescription inventory: ${response.status} ${body}`, 502);
  }

  const payload = await response.json().catch(() => null);
  const rawItems = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  if (!Array.isArray(rawItems)) {
    throw new AppError('Invalid prescription inventory response format.', 502);
  }

  const normalized = rawItems
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: String(item.id || item._id || '').trim(),
      name: String(item.name || '').trim(),
      dosage: String(item.dosage || '').trim(),
      quantity: Number(item.quantity || 0),
      price: Number(item.price || 0),
      expiry: item.expiry ? String(item.expiry) : '',
      status: String(item.status || '').trim(),
    }))
    .filter((item) => item.id && item.name && item.dosage && item.price >= 0);

  prescriptionInventoryCache = { timestamp: now, items: normalized };
  return normalized;
};

const toDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const makeRecordId = () =>
  `REC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const isInStock = (status = '') => status.trim().toUpperCase() === 'IN STOCK';

const validatePrescriptionMedicines = async (details = {}) => {
  const requestedMedicines = Array.isArray(details.medicines) ? details.medicines : [];
  if (requestedMedicines.length === 0) {
    throw new AppError('Add at least one medicine to the prescription.', 422);
  }

  const inventory = await fetchPrescriptionInventory();

  const medicines = requestedMedicines.map((item) => {
    const medicineId = typeof item.medicineId === 'string' ? item.medicineId.trim() : '';
    if (!medicineId) {
      throw new AppError('Medicine selection is required.', 422);
    }

    const inventoryItem = inventory.find((candidate) => candidate.id === medicineId);
    if (!inventoryItem) {
      throw new AppError('Selected medicine is not found in inventory.', 422);
    }

    if (!isInStock(inventoryItem.status) || inventoryItem.quantity <= 0) {
      throw new AppError(`${inventoryItem.name} is not currently available.`, 422);
    }

    const prescribedQuantity = Number(item.prescribedQuantity || 0);
    if (prescribedQuantity < 1) {
      throw new AppError('Quantity must be at least 1.', 422);
    }

    if (prescribedQuantity > inventoryItem.quantity) {
      throw new AppError(
        `Quantity for ${inventoryItem.name} cannot exceed available stock (${inventoryItem.quantity}).`,
        422
      );
    }

    const unitPrice = Number(inventoryItem.price || 0);

    return {
      medicineId: inventoryItem.id,
      medicineName: inventoryItem.name,
      prescribedDosage: String(item.prescribedDosage || inventoryItem.dosage).trim(),
      availableQuantity: inventoryItem.quantity,
      prescribedQuantity,
      unitPrice,
      totalPrice: Number((unitPrice * prescribedQuantity).toFixed(2)),
      expiry: inventoryItem.expiry || '',
      status: inventoryItem.status || '',
    };
  });

  const totalQuantity = medicines.reduce((total, item) => total + item.prescribedQuantity, 0);
  const title = medicines.map((item) => item.medicineName).join(', ');

  return {
    title,
    summary: details.directionsForUse || '',
    medicines,
    medicationName: medicines[0]?.medicineName || '',
    dosage: medicines[0]?.prescribedDosage || '',
    directionsForUse: details.directionsForUse || '',
    quantity: totalQuantity,
    startDate: details.startDate || '',
    endDate: details.endDate || '',
  };
};

exports.getHealthRecords = async (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.max(1, parseInt(query.limit, 10) || 20);
  const skip = (page - 1) * limit;

  const filter = {};
  if (query.patient_id) filter.patient_id = query.patient_id;
  if (query.record_type) filter.record_type = query.record_type;
  if (query.save_state) filter.save_state = query.save_state;
  if (query.include_archived !== 'true') filter.archived = false;
  if (query.date) {
    const start = toDate(`${query.date}T00:00:00`);
    const end = toDate(`${query.date}T23:59:59.999`);
    if (start && end) filter.record_date = { $gte: start, $lte: end };
  }
  if (query.search) {
    const q = new RegExp(query.search, 'i');
    filter.$or = [{ patient_name: q }, { provider: q }, { summary: q }];
  }

  const [total, records] = await Promise.all([
    HealthRecord.countDocuments(filter),
    HealthRecord.find(filter).sort({ record_date: -1 }).skip(skip).limit(limit),
  ]);

  return {
    results: records.length,
    records,
    pagination: { total, page, pages: Math.ceil(total / limit) || 1, limit },
  };
};

exports.getHealthRecordById = async (recordId) => {
  const record = await HealthRecord.findOne({ record_id: recordId });
  if (!record) throw new AppError('Health record not found.', 404);
  return record;
};

exports.createHealthRecord = async (data, actor) => {
  const recordDate = toDate(data.record_date);
  if (!recordDate) throw new AppError('Invalid record_date.', 422);

  let normalizedDetails =
    data.record_type === 'Prescription'
      ? (data.details || {})
      : (data.details || {});

  if (data.record_type === 'Prescription') {
    normalizedDetails = await validatePrescriptionMedicines(normalizedDetails);
  }

  const record = await HealthRecord.create({
    record_id: makeRecordId(),
    patient_id: data.patient_id,
    patient_name: data.patient_name,
    record_type: data.record_type,
    record_date: recordDate,
    provider: data.provider,
    save_state: data.save_state || 'final',
    summary: data.summary || '',
    details: normalizedDetails,
    created_by: actor?.id,
  });

  logger.info({
    event: 'HEALTH_RECORD_CREATED',
    actor_id: actor?.id,
    actor_role: actor?.role,
    ip: actor?.ip,
    record_id: record.record_id,
    patient_id: record.patient_id,
  });

  if (record.record_type === 'Prescription') {
    await invoiceService.createInvoiceForHealthRecord(record, actor);
  }

  return record;
};

exports.updateHealthRecord = async (recordId, updates, actor) => {
  const clientVersion = typeof updates.__v !== 'undefined' ? updates.__v : null;
  if (typeof updates.__v !== 'undefined') delete updates.__v;

  const record = await HealthRecord.findOne({ record_id: recordId });
  if (!record) throw new AppError('Health record not found.', 404);
  if (record.archived) throw new AppError('Archived health record cannot be updated.', 409);

  if (clientVersion !== null && record.__v !== clientVersion) {
    const err = new AppError('Conflict: resource has been modified.', 409);
    err.currentVersion = record.__v;
    throw err;
  }

  if (typeof updates.record_date !== 'undefined') {
    const nextDate = toDate(updates.record_date);
    if (!nextDate) throw new AppError('Invalid record_date.', 422);
    record.record_date = nextDate;
  }

  const assignable = ['patient_id', 'patient_name', 'record_type', 'provider', 'save_state', 'summary'];
  assignable.forEach((key) => {
    if (typeof updates[key] !== 'undefined') record[key] = updates[key];
  });
  if (typeof updates.details !== 'undefined') {
    const effectiveType = updates.record_type || record.record_type;
    if (effectiveType === 'Prescription') {
      record.details = await validatePrescriptionMedicines(updates.details || {});
    } else {
      record.details = updates.details;
    }
  }
  record.updated_by = actor?.id;

  await record.save();

  logger.info({
    event: 'HEALTH_RECORD_UPDATED',
    actor_id: actor?.id,
    actor_role: actor?.role,
    ip: actor?.ip,
    record_id: record.record_id,
  });

  return record;
};

exports.getPrescriptionMedicines = async () => fetchPrescriptionInventory();

exports.deleteHealthRecord = async (recordId, actor) => {
  const record = await HealthRecord.findOneAndUpdate(
    { record_id: recordId },
    {
      $set: {
        archived: true,
        archived_at: new Date(),
        updated_by: actor?.id,
      },
    },
    { new: true }
  );
  if (!record) throw new AppError('Health record not found.', 404);

  logger.info({
    event: 'HEALTH_RECORD_ARCHIVED',
    actor_id: actor?.id,
    actor_role: actor?.role,
    ip: actor?.ip,
    record_id: record.record_id,
  });

  return record;
};
