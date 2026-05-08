const Joi = require('joi');

const auditLogQuerySchema = Joi.object({
  action_type: Joi.string().trim().optional(),
  action: Joi.string().trim().optional(),
  user_id: Joi.string().trim().optional(),
  actor_user_id: Joi.string().trim().optional(),
  subsystem: Joi.string().trim().optional(),
  entity_type: Joi.string().trim().optional(),
  start_date: Joi.string().trim().optional(),
  end_date: Joi.string().trim().optional(),
  search: Joi.string().trim().optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});

const telehealthAuditEventSchema = Joi.object({
  action_type: Joi.string().valid('START_TELEHEALTH_CALL', 'END_TELEHEALTH_CALL', 'TELEHEALTH_STARTED', 'TELEHEALTH_ENDED').optional(),
  action: Joi.string().valid('START_TELEHEALTH_CALL', 'END_TELEHEALTH_CALL', 'TELEHEALTH_STARTED', 'TELEHEALTH_ENDED').optional(),
  appointment_id: Joi.string().trim().required(),
  description: Joi.string().trim().optional().allow(''),
}).or('action_type', 'action');

module.exports = {
  auditLogQuerySchema,
  telehealthAuditEventSchema,
};
