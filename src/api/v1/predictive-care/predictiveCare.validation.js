const Joi = require('joi');

const ALERT_TYPES = [
  'LAB_TREND',
  'CHRONIC_RISK',
  'VACCINATION_GAP',
  'ADHERENCE_GAP',
  'NO_SHOW_RISK',
  'READMISSION_RISK',
  'CRITICAL_LAB',
];

exports.patientIdParamSchema = Joi.object({
  patientId: Joi.string().trim().required(),
});

exports.riskProfileListQuerySchema = Joi.object({
  risk_level: Joi.string().valid('Low', 'Moderate', 'High', 'Critical').optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});

exports.alertsListQuerySchema = Joi.object({
  patient_id: Joi.string().trim().optional(),
  alert_type: Joi.string()
    .valid(...ALERT_TYPES)
    .optional(),
  severity: Joi.string().valid('Info', 'Warning', 'Critical').optional(),
  is_resolved: Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid('true', 'false'))
    .optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});

exports.mongoIdParamSchema = Joi.object({
  id: Joi.string()
    .length(24)
    .pattern(/^[a-fA-F0-9]{24}$/)
    .required()
    .messages({ 'string.pattern.base': 'Invalid alert ID' }),
});

exports.resolveAlertBodySchema = Joi.object({
  resolved_by: Joi.string().trim().optional(),
}).unknown(false);
