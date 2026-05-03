// Crash immediately if required env vars are not set (PORT optional)
const required = ['MONGO_URI', 'JWT_SECRET'];
required.forEach((key) => {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
});

// Provide a sensible default for PORT if not supplied
process.env.PORT = process.env.PORT || '3000';

module.exports = process.env;
