const AppError = require('../utils/AppError');

exports.validate = (schema) => (req, res, next) => {
  const options = { abortEarly: false, allowUnknown: false };
  const { error } = schema.validate(req.body, options);
  if (error) {
    const messages = error.details.map((d) => d.message);
    return next(new AppError(messages.join('. '), 422));
  }
  next();
};

/**
 * Validate req.params, req.query, or req.body using the same Joi error shape as `validate`.
 * @param {import('joi').ObjectSchema} schema
 * @param {'params'|'query'|'body'} part
 */
exports.validatePart = (schema, part = 'params') => (req, res, next) => {
  const payload = req[part];
  const options = {
    abortEarly: false,
    allowUnknown: part === 'query',
  };
  const { error, value } = schema.validate(payload, options);
  if (error) {
    const messages = error.details.map((d) => d.message);
    return next(new AppError(messages.join('. '), 422));
  }
  req[part] = value;
  next();
};
