const Joi = require('joi');

const createAppointmentSchema = Joi.object({
  patient_id: Joi.string().trim().required(),
  patient_name: Joi.string().trim().required(),
  appointment_type: Joi.string().valid('In-Person', 'Telehealth').default('In-Person'),
  date: Joi.string().trim().required(),
  time: Joi.string().trim().required(),
  duration_minutes: Joi.number().valid(15, 30, 45, 60).default(30),
  reason: Joi.string().trim().allow('').default(''),
  priority: Joi.string().valid('Routine', 'Urgent', 'Follow-up').default('Routine'),
  status: Joi.string().valid('Pending', 'Confirmed', 'Cancelled', 'Completed').default('Pending'),
  send_email_reminder: Joi.boolean().default(false),
  send_sms_reminder: Joi.boolean().default(false),
  send_confirmation: Joi.boolean().default(true),
  internal_notes: Joi.string().trim().allow('').default(''),
});

const updateAppointmentSchema = Joi.object({
  patient_id: Joi.string().trim().optional(),
  patient_name: Joi.string().trim().optional(),
  appointment_type: Joi.string().valid('In-Person', 'Telehealth').optional(),
  date: Joi.string().trim().optional(),
  time: Joi.string().trim().optional(),
  duration_minutes: Joi.number().valid(15, 30, 45, 60).optional(),
  reason: Joi.string().trim().allow('').optional(),
  priority: Joi.string().valid('Routine', 'Urgent', 'Follow-up').optional(),
  status: Joi.string().valid('Pending', 'Confirmed', 'Cancelled', 'Completed').optional(),
  send_email_reminder: Joi.boolean().optional(),
  send_sms_reminder: Joi.boolean().optional(),
  send_confirmation: Joi.boolean().optional(),
  internal_notes: Joi.string().trim().allow('').optional(),
  __v: Joi.number().integer().min(0).optional(),
  appointment_id: Joi.forbidden(),
  scheduled_at: Joi.forbidden(),
  created_by: Joi.forbidden(),
  updated_by: Joi.forbidden(),
  cancelled_at: Joi.forbidden(),
  cancel_reason: Joi.forbidden(),
}).min(1);

const cancelAppointmentSchema = Joi.object({
  reason: Joi.string().trim().allow('').default(''),
});

module.exports = { createAppointmentSchema, updateAppointmentSchema, cancelAppointmentSchema };
