#!/usr/bin/env node

require('dotenv').config();

const mongoose = require('mongoose');

const connectDB = require('../src/config/db');
const PrescriptionInvoice = require('../src/api/v1/prescription-invoices/prescriptionInvoice.model');

async function main() {
  const closeWhenDone = mongoose.connection.readyState !== 1;

  try {
    await connectDB();

    const result = await PrescriptionInvoice.updateMany(
      {},
      {
        $set: {
          status: 'pending',
          is_released: false,
        },
      }
    );

    console.log('Prescription invoice reset complete.');
    console.log(`Matched: ${result.matchedCount}`);
    console.log(`Modified: ${result.modifiedCount}`);
  } finally {
    if (closeWhenDone) {
      await mongoose.connection.close().catch(() => undefined);
    }
  }
}

main().catch((err) => {
  console.error('Prescription invoice reset failed:', err);
  process.exit(1);
});
