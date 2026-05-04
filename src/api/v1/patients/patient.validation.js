const Joi = require('joi');

const createPatientSchema = Joi.object({
  first_name: Joi.string().trim().required(),
  last_name: Joi.string().trim().required(),
  date_of_birth: Joi.date().iso().required(),
  gender: Joi.string().valid('Male', 'Female', 'Other').required(),
  // Allow common phone formats (digits, spaces, dashes, parentheses, optional +). 7-20 chars
  contact_number: Joi.string().trim().pattern(/^[+0-9()\-\.\s]{7,20}$/).required(),
  email_address: Joi.string().email().trim().optional().allow(null, ''),
  address: Joi.string().trim().required(),
  national_id: Joi.string().trim().optional().allow(null, ''),
  // Emergency Contact (optional)
  emergency_contact_name: Joi.string().trim().optional().allow(null, ''),
  emergency_contact_relationship: Joi.string().trim().optional().allow(null, ''),
  emergency_contact_phone: Joi.string().trim().optional().allow(null, ''),
  // Health Information (optional) - accept arrays or strings
  allergies: Joi.alternatives().try(
    Joi.array().items(Joi.string().trim()),
    Joi.string().trim()
  ).optional().allow(null, ''),
  medications: Joi.alternatives().try(
    Joi.array().items(Joi.string().trim()),
    Joi.string().trim()
  ).optional().allow(null, ''),
  // Insurance (optional)
  // New nested insurance object (preferred)
  insurance: Joi.object({
    provider: Joi.string().trim().optional().allow(null, ''),
    coverage_percentage: Joi.number().min(0).max(100).optional().allow(null),
    policy_number: Joi.string().trim().optional().allow(null, ''),
    group_number: Joi.string().trim().optional().allow(null, ''),
  }).optional().allow(null),
  // Backwards-compatible flat fields (still accepted)
  insurance_provider: Joi.string().trim().optional().allow(null, ''),
  policy_number: Joi.string().trim().optional().allow(null, ''),
  group_number: Joi.string().trim().optional().allow(null, ''),
  // Additional Notes (optional)
  notes: Joi.string().trim().optional().allow(null, ''),
  // `created_by` is supplied from the authenticated actor in the controller/service
  created_by: Joi.string().optional(),
});

const updatePatientSchema = Joi.object({
  first_name: Joi.string().trim().optional(),
  last_name: Joi.string().trim().optional(),
  date_of_birth: Joi.date().iso().optional(),
  gender: Joi.string().valid('Male', 'Female', 'Other').optional(),
  contact_number: Joi.string().trim().pattern(/^[+0-9()\-\.\s]{7,20}$/).optional(),
  email_address: Joi.string().email().trim().optional().allow(null, ''),
  address: Joi.string().trim().optional(),
  national_id: Joi.string().trim().optional().allow(null, ''),
  // Emergency Contact (optional)
  emergency_contact_name: Joi.string().trim().optional().allow(null, ''),
  emergency_contact_relationship: Joi.string().trim().optional().allow(null, ''),
  emergency_contact_phone: Joi.string().trim().optional().allow(null, ''),
  // Health Information (optional) - accept arrays or strings
  allergies: Joi.alternatives().try(
    Joi.array().items(Joi.string().trim()),
    Joi.string().trim()
  ).optional().allow(null, ''),
  medications: Joi.alternatives().try(
    Joi.array().items(Joi.string().trim()),
    Joi.string().trim()
  ).optional().allow(null, ''),
  // Insurance (optional)
  // New nested insurance object (preferred)
  insurance: Joi.object({
    provider: Joi.string().trim().optional().allow(null, ''),
    coverage_percentage: Joi.number().min(0).max(100).optional().allow(null),
    policy_number: Joi.string().trim().optional().allow(null, ''),
    group_number: Joi.string().trim().optional().allow(null, ''),
  }).optional().allow(null),
  // Backwards-compatible flat fields (still accepted)
  insurance_provider: Joi.string().trim().optional().allow(null, ''),
  policy_number: Joi.string().trim().optional().allow(null, ''),
  group_number: Joi.string().trim().optional().allow(null, ''),
  // Additional Notes (optional)
  notes: Joi.string().trim().optional().allow(null, ''),
  updated_by: Joi.string().optional(),
  // Immutable fields must not be provided during updates
  patient_id: Joi.forbidden(),
  created_by: Joi.forbidden(),
  registration_date: Joi.forbidden(),
}).min(1);

module.exports = { createPatientSchema, updatePatientSchema };
