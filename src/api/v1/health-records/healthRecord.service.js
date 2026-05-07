const HealthRecord = require('./healthRecord.model');
const Patient = require('../patients/patient.model');
const Appointment = require('../appointments/appointment.model');
const PrescriptionInvoice = require('../prescription-invoices/prescriptionInvoice.model');
const invoiceService = require('../prescription-invoices/prescriptionInvoice.service');
const AppError = require('../../../utils/AppError');
const logger = require('../../../utils/logger');
const { normalizeHealthRecordDetails } = require('./healthRecord.normalize');
const { categorizeCondition } = require('./conditionCategory.helper');

const INVENTORY_CACHE_TTL = 60 * 1000;
let prescriptionInventoryCache = { timestamp: 0, items: [] };

const getPrescriptionInventoryAuth = () => {
  const apiKey = String(process.env.PRESCRIPTION_API_KEY || '').trim();
  const bearerToken = String(process.env.PRESCRIPTION_API_BEARER_TOKEN || '').trim();

  if (bearerToken) {
    return {
      headers: { Authorization: `Bearer ${bearerToken}` },
      mode: 'bearer',
    };
  }

  if (apiKey) {
    return {
      headers: { 'x-api-key': apiKey },
      mode: 'x-api-key',
    };
  }

  return { headers: {}, mode: 'none' };
};

const fetchPrescriptionInventory = async () => {
  const url = String(process.env.PRESCRIPTION_API_URL || '').trim();
  if (!url) {
    throw new AppError('Prescription inventory URL is not configured.', 500);
  }
  const auth = getPrescriptionInventoryAuth();

  const now = Date.now();
  if (now - prescriptionInventoryCache.timestamp < INVENTORY_CACHE_TTL) {
    return prescriptionInventoryCache.items;
  }

  const httpFetch = typeof fetch !== 'undefined' ? fetch : null;
  if (!httpFetch) {
    throw new AppError('Server fetch API is unavailable. Please run on Node 18+ or install a fetch polyfill.', 500);
  }

  if (auth.mode === 'none') {
    logger.error({
      event: 'PRESCRIPTION_INVENTORY_AUTH_MISSING',
      url,
      hasApiKey: Boolean(String(process.env.PRESCRIPTION_API_KEY || '').trim()),
      hasBearerToken: Boolean(String(process.env.PRESCRIPTION_API_BEARER_TOKEN || '').trim()),
    });
    throw new AppError('Prescription inventory authentication is not configured.', 500);
  }

  const headers = { Accept: 'application/json', ...auth.headers };
  const response = await httpFetch(url, { headers });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error({
      event: 'PRESCRIPTION_INVENTORY_FETCH_FAILED',
      url,
      status: response.status,
      authMode: auth.mode,
      responseBody: body.slice(0, 500),
    });
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

const getCanonicalPatientName = (patient) =>
  [patient?.first_name, patient?.last_name].filter(Boolean).join(' ').trim();

const loadPatientOrThrow = async (patientId) => {
  const patient = await Patient.findOne({ patient_id: patientId });
  if (!patient) throw new AppError('Patient not found.', 404);
  return patient;
};

const validateLinkedAppointment = async (details = {}, patientId) => {
  const appointmentId = String(details?.appointmentId || '').trim();
  if (!appointmentId) return;

  const appointment = await Appointment.findOne({ appointment_id: appointmentId });
  if (!appointment) {
    throw new AppError('Linked appointment not found.', 422);
  }
  if (appointment.patient_id !== patientId) {
    throw new AppError('Linked appointment belongs to a different patient_id.', 422);
  }
};

const syncPrescriptionInvoicesForRecord = async (record, actor) => {
  if (!record || record.record_type !== 'Prescription') return;

  await PrescriptionInvoice.updateMany(
    { health_record_id: record.record_id },
    {
      $set: {
        patient_id: record.patient_id,
        patient_name: record.patient_name,
        updated_by: actor?.id,
      },
    }
  );
};

const normalizePrescriptionRequest = (details = {}) => {
  const requestedMedicines = Array.isArray(details.medicines) ? details.medicines : [];
  if (requestedMedicines.length > 0) {
    return requestedMedicines;
  }

  const medicationName = String(details.prescriptionMedicationName || details.medicationName || '').trim();
  const prescribedDosage = String(details.prescriptionDosage || details.dosage || '').trim();
  const prescribedQuantity = Number.isNaN(Number(details.prescriptionQuantity || details.quantity || 0))
    ? 1
    : Number(details.prescriptionQuantity || details.quantity || 1);

  if (!medicationName || !prescribedDosage) {
    return [];
  }

  return [
    {
      medicineId: String(details.medicineId || '').trim(),
      medicineName: medicationName,
      prescribedDosage,
      prescribedQuantity: Math.max(1, prescribedQuantity),
      unitPrice: Number(details.unitPrice || 0),
      expiry: String(details.expiry || '').trim(),
      status: String(details.status || '').trim(),
    },
  ];
};

const validatePrescriptionMedicines = async (details = {}) => {
  const requestedMedicines = normalizePrescriptionRequest(details);
  if (requestedMedicines.length === 0) {
    throw new AppError('Add at least one medicine to the prescription.', 422);
  }

  const inventory = await fetchPrescriptionInventory();

  const medicines = requestedMedicines.map((item) => {
    const medicineId = typeof item.medicineId === 'string' ? item.medicineId.trim() : '';
    const medicineName = typeof item.medicineName === 'string' ? item.medicineName.trim() : '';
    const prescribedQuantity = Number(item.prescribedQuantity || 0);

    if (!medicineId && !medicineName) {
      throw new AppError('Medicine selection is required.', 422);
    }

    const inventoryItem = inventory.find((candidate) => candidate.id === medicineId || candidate.name.toLowerCase() === medicineName.toLowerCase());
    if (inventoryItem) {
      if (!isInStock(inventoryItem.status) || inventoryItem.quantity <= 0) {
        throw new AppError(`${inventoryItem.name} is not currently available.`, 422);
      }
    }

    if (!isNaN(prescribedQuantity) && prescribedQuantity < 1) {
      throw new AppError('Quantity must be at least 1.', 422);
    }

    if (inventoryItem && prescribedQuantity > inventoryItem.quantity) {
      throw new AppError(
        `Quantity for ${inventoryItem.name} cannot exceed available stock (${inventoryItem.quantity}).`,
        422
      );
    }

    const unitPrice = inventoryItem ? Number(inventoryItem.price || 0) : Number(item.unitPrice || 0);
    const quantity = Number.isNaN(prescribedQuantity) ? 1 : prescribedQuantity;

    return {
      medicineId: inventoryItem ? inventoryItem.id : medicineId || medicineName.replace(/\s+/g, '-').toUpperCase(),
      medicineName: inventoryItem ? inventoryItem.name : medicineName,
      prescribedDosage: String(item.prescribedDosage || item.dosage || '').trim(),
      availableQuantity: inventoryItem ? inventoryItem.quantity : quantity,
      prescribedQuantity: quantity,
      unitPrice,
      totalPrice: Number((unitPrice * quantity).toFixed(2)),
      expiry: inventoryItem ? inventoryItem.expiry || '' : String(item.expiry || '').trim(),
      status: inventoryItem ? inventoryItem.status || '' : String(item.status || 'Unknown').trim(),
    };
  });

  const totalQuantity = medicines.reduce((total, item) => total + item.prescribedQuantity, 0);
  const title = medicines.map((item) => item.medicineName).join(', ');
  const directionsForUse = String(details.directionsForUse || details.prescriptionDirections || '').trim();

  return {
    title,
    summary: directionsForUse,
    medicines,
    medicationName: medicines[0]?.medicineName || '',
    dosage: medicines[0]?.prescribedDosage || '',
    directionsForUse,
    quantity: totalQuantity,
    startDate: String(details.startDate || details.prescriptionStartDate || '').trim(),
    endDate: String(details.endDate || details.prescriptionEndDate || '').trim(),
  };
};

exports.getHealthRecords = async (query = {}, actor = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.max(1, parseInt(query.limit, 10) || 20);
  const skip = (page - 1) * limit;

  const filter = {};
  if (actor.role === 'patient' && actor.patient_id) {
    filter.patient_id = actor.patient_id;
  } else if (query.patient_id) {
    filter.patient_id = query.patient_id;
  }
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

exports.getHealthRecordById = async (recordId, actor = {}) => {
  const record = await HealthRecord.findOne({ record_id: recordId });
  if (!record) throw new AppError('Health record not found.', 404);
  if (actor.role === 'patient' && actor.patient_id && record.patient_id !== actor.patient_id) {
    throw new AppError('Forbidden: cannot access another patient record.', 403);
  }
  return record;
};

exports.createHealthRecord = async (data, actor) => {
  const recordDate = toDate(data.record_date);
  if (!recordDate) throw new AppError('Invalid record_date.', 422);
  if (!data.patient_id) throw new AppError('patient_id is required.', 422);

  const patient = await loadPatientOrThrow(data.patient_id);
  const canonicalPatientName = getCanonicalPatientName(patient);

  let normalizedDetails =
    data.record_type === 'Prescription'
      ? (data.details || {})
      : (data.details || {});

  if (data.record_type === 'Prescription') {
    normalizedDetails = await validatePrescriptionMedicines(normalizedDetails);
  } else {
    normalizedDetails = normalizeHealthRecordDetails(data.record_type, normalizedDetails);
  }
  await validateLinkedAppointment(normalizedDetails, patient.patient_id);

  const record = await HealthRecord.create({
    record_id: makeRecordId(),
    patient_id: patient.patient_id,
    patient_name: canonicalPatientName,
    record_type: data.record_type,
    record_date: recordDate,
    provider: data.provider,
    save_state: data.save_state || 'final',
    summary: data.summary || '',
    condition_category: categorizeCondition({
      record_type: data.record_type,
      summary: data.summary || '',
      details: normalizedDetails,
    }),
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

  const nextPatientId = typeof updates.patient_id !== 'undefined'
    ? String(updates.patient_id || '').trim()
    : record.patient_id;
  if (!nextPatientId) throw new AppError('patient_id is required.', 422);
  const nextPatient = await loadPatientOrThrow(nextPatientId);

  const assignable = ['patient_id', 'record_type', 'provider', 'save_state', 'summary'];
  assignable.forEach((key) => {
    if (typeof updates[key] !== 'undefined') record[key] = updates[key];
  });
  if (typeof updates.details !== 'undefined') {
    const effectiveType = updates.record_type || record.record_type;
    if (effectiveType === 'Prescription') {
      record.details = await validatePrescriptionMedicines(updates.details || {});
    } else {
      record.details = normalizeHealthRecordDetails(effectiveType, updates.details || {});
    }
  }
  await validateLinkedAppointment(record.details || {}, nextPatient.patient_id);
  record.patient_id = nextPatient.patient_id;
  record.patient_name = getCanonicalPatientName(nextPatient);
  record.condition_category = categorizeCondition({
    record_type: record.record_type,
    summary: record.summary || '',
    details: record.details || {},
  });
  record.updated_by = actor?.id;

  await record.save();
  await syncPrescriptionInvoicesForRecord(record, actor);

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

exports.__private__ = {
  fetchPrescriptionInventory,
  getPrescriptionInventoryAuth,
};

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
    { returnDocument: 'after' }
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
