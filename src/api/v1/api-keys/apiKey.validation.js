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

module.exports = { createApiKeySchema };
