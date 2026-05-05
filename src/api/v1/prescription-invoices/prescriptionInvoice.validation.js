const Joi = require('joi');

const invoiceItemSchema = Joi.object({
  medicineId: Joi.string().trim().required(),
  medicineName: Joi.string().trim().required(),
  prescribedDosage: Joi.string().trim().required(),
  prescribedQuantity: Joi.number().integer().min(1).required(),
  unitPrice: Joi.number().min(0).required(),
  totalPrice: Joi.number().min(0).required(),
}).unknown(true);

const createPrescriptionInvoiceSchema = Joi.object({
  patient_id: Joi.string().trim().required(),
  patient_name: Joi.string().trim().required(),
  health_record_id: Joi.string().trim().allow('').optional(),
  items: Joi.array().items(invoiceItemSchema).min(1).required(),
  // arbitrary variable (accept any simple value) and release flag
  variable: Joi.alternatives().try(Joi.object(), Joi.array(), Joi.string(), Joi.number(), Joi.boolean()).optional().allow(null),
  is_released: Joi.boolean().optional().default(false),
  total_amount: Joi.number().min(0).required(),
  invoice_date: Joi.string().trim().optional(),
  status: Joi.string().valid('pending', 'paid', 'cancelled').default('pending'),
}).unknown(true);

const updatePrescriptionInvoiceStatusSchema = Joi.object({
  status: Joi.string().valid('pending', 'paid', 'cancelled').required(),
}).unknown(false);

module.exports = {
  createPrescriptionInvoiceSchema,
  updatePrescriptionInvoiceStatusSchema,
};
