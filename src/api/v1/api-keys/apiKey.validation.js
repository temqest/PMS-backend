const Joi = require('joi');

const createApiKeySchema = Joi.object({
  name: Joi.string()
    .required()
    .trim()
    .min(3)
    .max(100)
    .messages({
      'string.empty': 'API key name is required',
      'string.min': 'API key name must be at least 3 characters',
      'string.max': 'API key name must not exceed 100 characters',
    }),
  description: Joi.string()
    .optional()
    .trim()
    .max(500)
    .messages({
      'string.max': 'Description must not exceed 500 characters',
    }),
  permissions: Joi.array()
    .optional()
    .items(Joi.string().valid('read:invoices', 'read:patients', 'write:invoices'))
    .default(['read:invoices'])
    .messages({
      'array.includes': 'Invalid permission. Allowed: read:invoices, read:patients, write:invoices',
    }),
});

const updateApiKeySchema = Joi.object({
  name: Joi.string()
    .optional()
    .trim()
    .min(3)
    .max(100),
  description: Joi.string()
    .optional()
    .trim()
    .max(500)
    .allow(''),
  // Allow adding new permissions without code changes.
  // If you want to restrict this to a fixed allowlist, we can tighten it later.
  permissions: Joi.array()
    .optional()
    .items(Joi.string().trim().min(1).max(100))
    .min(1),
}).min(1);

module.exports = { createApiKeySchema, updateApiKeySchema };
