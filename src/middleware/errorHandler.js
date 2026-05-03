const AppError = require('../utils/AppError');

const sendErrorDev = (err, req, res) => {
  if (!err) return res.status(500).json({ status: 'error', message: 'An unknown error occurred' });
  res.status(err.statusCode).json({
    status: err.status,
    message: err.message,
    stack: err.stack,
  });
};

const generateErrorId = () => `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(16)}`;

const sendErrorProd = (err, req, res) => {
  if (!err) return res.status(500).json({ status: 'error', message: 'An unknown error occurred' });
  if (err.isOperational) {
    // Operational, safe to send the message
    res.status(err.statusCode).json({ status: err.status, message: err.message });
    return;
  }

  // Unexpected error: log structured details to help debugging (correlate with Vercel logs)
  const errorId = generateErrorId();
  const logPayload = {
    errorId,
    time: new Date().toISOString(),
    message: err.message,
    name: err.name,
    statusCode: err.statusCode || 500,
    method: req.method,
    path: req.originalUrl || req.url,
    // don't log full headers or body to avoid leaking secrets, but include sizes
    headersPresent: Object.keys(req.headers || {}).length,
    bodyPresent: req.body ? true : false,
    stack: err.stack,
  };

  console.error('UNEXPECTED ERROR:', JSON.stringify(logPayload));

  // Return a non-sensitive message but include the error id for correlation
  res.status(500).json({ status: 'error', message: `An internal error occurred. Reference id: ${errorId}` });
};

module.exports = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (err.code === 11000) {
    err = new AppError('Duplicate entry detected. Patient may already exist.', 409);
  }
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    err = new AppError(messages.join('. '), 422);
  }
  if (err.name === 'MongoServerSelectionError' || err.message?.includes('connection <monitor>')) {
    err = new AppError('Database unavailable. Please try again later.', 503);
  }
  if (err.name === 'JsonWebTokenError') err = new AppError('Invalid token.', 401);
  if (err.name === 'TokenExpiredError') err = new AppError('Token expired. Please re-authenticate.', 401);

  process.env.NODE_ENV === 'development' ? sendErrorDev(err, req, res) : sendErrorProd(err, req, res);
};
