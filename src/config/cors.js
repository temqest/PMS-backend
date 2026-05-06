const parseAllowedOrigins = () => (
  (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
);

const allowedOrigins = parseAllowedOrigins();
const allowAllOrigins = process.env.NODE_ENV !== 'production' && allowedOrigins.length === 0;

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalizedOrigin = origin.replace(/\/$/, '');

    if (allowAllOrigins || allowedOrigins.includes(normalizedOrigin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS origin not allowed: ${normalizedOrigin}`));
  },
};

module.exports = {
  allowedOrigins,
  corsOptions,
};
