const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Import the service
const { computePredictiveCareForAllActivePatients } = require('../src/api/v1/predictive-care/services/predictiveCareOrchestrator.service');

// DB connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/pms');
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('DB connection error:', error);
    process.exit(1);
  }
};

const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (error) {
    console.error('DB disconnect error:', error);
  }
};

const runBatchComputation = async () => {
  try {
    console.log('Starting batch computation of risk profiles for all active patients...');
    await computePredictiveCareForAllActivePatients();
    console.log('Batch computation completed successfully.');
  } catch (error) {
    console.error('Error during batch computation:', error);
    process.exit(1);
  }
};

const main = async () => {
  await connectDB();
  await runBatchComputation();
  await disconnectDB();
  process.exit(0);
};

main();