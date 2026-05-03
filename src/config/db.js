const mongoose = require('mongoose');

let connectionPromise = null;
let listenersRegistered = false;

const createConnectionOptions = () => ({
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
  family: 4,
  maxPoolSize: 10,
  minPoolSize: 0,
  appName: 'pms-backend',
});

const registerConnectionListeners = () => {
  if (listenersRegistered) return;
  listenersRegistered = true;

  const conn = mongoose.connection;
  conn.on('connected', () => {
    console.log('MongoDB connected');
  });
  conn.on('disconnected', () => {
    console.warn('MongoDB disconnected');
  });
  conn.on('reconnected', () => {
    console.log('MongoDB reconnected');
  });
  conn.on('error', (err) => {
    console.error('MongoDB connection error:', err);
  });
};

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connectionPromise) return connectionPromise;

  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not defined');

  const options = createConnectionOptions();
  registerConnectionListeners();

  connectionPromise = (async () => {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await mongoose.connect(uri, options);
        return mongoose.connection;
      } catch (err) {
        console.error(`MongoDB connection attempt ${attempt} failed: ${err.message}`);
        if (attempt >= maxAttempts) {
          await mongoose.disconnect().catch(() => {});
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
  })();

  try {
    return await connectionPromise;
  } finally {
    if (mongoose.connection.readyState !== 1) {
      connectionPromise = null;
    }
  }
};

module.exports = connectDB;
