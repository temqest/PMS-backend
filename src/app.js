const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss');
const hpp = require('hpp');
const compression = require('compression');
const morgan = require('morgan');
const connectDB = require('./config/db');

const errorHandler = require('./middleware/errorHandler');
const patientRoutes = require('./api/v1/patients/patient.routes');
const authRoutes = require('./api/v1/auth/auth.routes');
const appointmentRoutes = require('./api/v1/appointments/appointment.routes');
const healthRecordRoutes = require('./api/v1/health-records/healthRecord.routes');
const prescriptionInvoiceRoutes = require('./api/v1/prescription-invoices/prescriptionInvoice.routes');
const apiKeyRoutes = require('./api/v1/api-keys/apiKey.routes');
const externalRoutes = require('./api/v1/external/external.routes');
const predictiveCareRoutes = require('./api/v1/predictive-care/routes/predictiveCare.routes');

const app = express();

// Vercel/edge proxies populate X-Forwarded-* headers; required by express-rate-limit.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors());
// Skip mongo sanitization in test env because some test request objects are read-only
// and the sanitizer attempts to reassign `req.query` which can cause errors
// in some serverless environments (Vercel). Use the library's `sanitize`
// function to mutate existing objects in-place and avoid reassigning the
// `req` properties which may be getter-only.
if (process.env.NODE_ENV !== 'test') {
    app.use((req, res, next) => {
      ['body', 'params', 'headers', 'query'].forEach((key) => {
        if (req[key]) {
          try {
            // mutate the existing object rather than assigning back to req[key]
            mongoSanitize.sanitize(req[key]);
          } catch (err) {
            // swallow sanitize errors to avoid crashing the request handler
          }
        }
      });

      // Sanitize string values using the maintained `xss` package instead
      // of the unmaintained `xss-clean` which attempts to reassign
      // read-only request properties in newer Node/Express.
      const sanitizeObject = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        Object.keys(obj).forEach((k) => {
          try {
            if (typeof obj[k] === 'string') obj[k] = xss(obj[k]);
            else if (typeof obj[k] === 'object') sanitizeObject(obj[k]);
          } catch (e) {
            // ignore individual sanitize errors
          }
        });
      };

      sanitizeObject(req.body);
      sanitizeObject(req.query);
      sanitizeObject(req.params);

      app.use(hpp());
      next();
    });
}
app.use(compression());

app.use(express.json({ limit: '10kb' }));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Ensure DB connection is initialized for serverless runtimes that don't execute server.js.
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    next(err);
  }
});

app.get('/', (req, res) => res.json({ status: 'ok' }));

// Health check endpoint: returns service status and basic diagnostics.
app.get('/health', (req, res) => {
  let db = { state: 'unknown' };
  try {
    // require mongoose lazily so this file can be loaded without DB in tests
    const mongoose = require('mongoose');
    const state = mongoose.connection && mongoose.connection.readyState;
    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    db = { state: state === undefined ? 'unknown' : state };
  } catch (e) {
    db = { state: 'unavailable' };
  }

  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    node: process.version,
    memory: process.memoryUsage(),
    db,
  });
});

// API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/patients', patientRoutes);
app.use('/api/v1/appointments', appointmentRoutes);
app.use('/api/v1/health-records', healthRecordRoutes);
app.use('/api/v1/prescription-invoices', prescriptionInvoiceRoutes);
app.use('/api/v1/api-keys', apiKeyRoutes); // Manage API keys
app.use('/api/v1/external', externalRoutes); // External API key authenticated routes
app.use('/api/v1/predictive-care', predictiveCareRoutes);

app.use((req, res) => {
  res.status(404).json({ status: 'fail', message: `Route ${req.originalUrl} not found` });
});

app.use(errorHandler);

module.exports = app;
