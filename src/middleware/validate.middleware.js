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
