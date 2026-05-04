/**
 * Script to mark all paid invoices as unpaid/pending
 * 
 * Usage: node scripts/revertInvoicesToUnpaid.js
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PrescriptionInvoice = require('../src/api/v1/prescription-invoices/prescriptionInvoice.model');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/pms');
    console.log('✓ Connected to MongoDB');
  } catch (error) {
    console.error('❌ DB connection error:', error);
    process.exit(1);
  }
};

const revertInvoicesToUnpaid = async () => {
  try {
    console.log('\n🔄 Reverting paid invoices to pending...\n');

    // Find all paid invoices
    const paidCount = await PrescriptionInvoice.countDocuments({ status: 'paid' });
    console.log(`Found ${paidCount} paid invoices\n`);

    if (paidCount === 0) {
      console.log('✓ No paid invoices found');
      return;
    }

    // Update all paid invoices to pending
    const result = await PrescriptionInvoice.updateMany(
      { status: 'paid' },
      { status: 'pending' }
    );

    console.log(`✅ Updated ${result.modifiedCount} invoices from "paid" to "pending"`);
    console.log(`   Matched: ${result.matchedCount}`);
    console.log(`   Modified: ${result.modifiedCount}\n`);

    // Show sample of updated invoices
    const samples = await PrescriptionInvoice.find({ status: 'pending' })
      .limit(3)
      .select('invoice_id status invoice_date total_amount');

    console.log('📋 Sample updated invoices:');
    samples.forEach(inv => {
      console.log(`   ${inv.invoice_id}: ${inv.status} | $${inv.total_amount} | ${new Date(inv.invoice_date).toLocaleDateString()}`);
    });

    console.log();

  } catch (error) {
    console.error('❌ Error:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    console.log('✓ Database connection closed\n');
  }
};

connectDB().then(() => revertInvoicesToUnpaid());
