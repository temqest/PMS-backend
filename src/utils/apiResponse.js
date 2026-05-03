exports.success = (res, statusCode, data, meta = {}) => {
  res.status(statusCode).json({ status: 'success', ...meta, data });
};

exports.fail = (res, statusCode, message) => {
  res.status(statusCode).json({ status: 'fail', message });
};
