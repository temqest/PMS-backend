const Joi = require('joi');

const recordTypes = ['Visit', 'Lab Result', 'Imaging', 'Prescription', 'Vaccination', 'Note'];
const saveStates = ['draft', 'final'];
const prescriptionMedicineSchema = Joi.object({
  medicineId: Joi.string().trim().required(),
  medicineName: Joi.string().trim().required(),
  prescribedDosage: Joi.string().trim().required(),
  availableQuantity: Joi.number().integer().min(0).required(),
  prescribedQuantity: Joi.number().integer().min(1).required(),
  unitPrice: Joi.number().min(0).required(),
  totalPrice: Joi.number().min(0).required(),
  expiry: Joi.string().trim().allow('').optional(),
  status: Joi.string().trim().allow('').optional(),
}).unknown(true);

const prescriptionDetailsSchema = Joi.object({
  medicines: Joi.array().items(prescriptionMedicineSchema).min(1).required(),
  directionsForUse: Joi.string().trim().required(),
  quantity: Joi.number().integer().min(1).required(),
  startDate: Joi.string().trim().required(),
  endDate: Joi.string().trim().allow('').optional(),
})
  .unknown(true)
  .required();

const createHealthRecordSchema = Joi.object({
  patient_id: Joi.string().trim().required(),
  patient_name: Joi.string().trim().required(),
  record_type: Joi.string().valid(...recordTypes).required(),
  record_date: Joi.string().trim().required(),
  provider: Joi.string().trim().required(),
  save_state: Joi.string().valid(...saveStates).default('final'),
  summary: Joi.string().trim().allow('').default(''),
  details: Joi.when('record_type', {
    is: 'Prescription',
    then: prescriptionDetailsSchema,
    otherwise: Joi.object().unknown(true).default({}),
  }),
});

const updateHealthRecordSchema = Joi.object({
  patient_id: Joi.string().trim().optional(),
  patient_name: Joi.string().trim().optional(),
  record_type: Joi.string().valid(...recordTypes).optional(),
  record_date: Joi.string().trim().optional(),
  provider: Joi.string().trim().optional(),
  save_state: Joi.string().valid(...saveStates).optional(),
  summary: Joi.string().trim().allow('').optional(),
  details: Joi.object().unknown(true).optional(),
  __v: Joi.number().integer().min(0).optional(),
  record_id: Joi.forbidden(),
  archived: Joi.forbidden(),
  archived_at: Joi.forbidden(),
  created_by: Joi.forbidden(),
  updated_by: Joi.forbidden(),
}).custom((value, helpers) => {
  if (value.record_type === 'Prescription' && typeof value.details !== 'undefined') {
    const { error } = prescriptionDetailsSchema.validate(value.details || {});
    if (error) return helpers.error('any.invalid', { message: error.message });
  }
  return value;
}).min(1);

module.exports = {
  createHealthRecordSchema,
  updateHealthRecordSchema,
};
