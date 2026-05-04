#!/usr/bin/env node
/*
  Seed patient insurance from prescription invoice `variable` field.

  Usage:
    node scripts/seedInvoiceInsurance.js [--dry-run] [--force] [--limit=N]

  --dry-run : don't perform updates, just report what would change
  --force   : overwrite existing patient insurance fields
  --limit=N : maximum invoices to process (default: all)

  The script looks for invoices where `variable` is present and attempts
  to map common insurance keys into the patient.insurance object:
    provider, coverage_percentage, policy_number, group_number
*/

require('dotenv').config();
const connectDB = require('../src/config/db');

const PrescriptionInvoice = require('../src/api/v1/prescription-invoices/prescriptionInvoice.model');
const Patient = require('../src/api/v1/patients/patient.model');

const argv = process.argv.slice(2);
const opts = {
  dryRun: argv.includes('--dry-run'),
  force: argv.includes('--force'),
  limit: null,
};
for (const a of argv) {
  if (a.startsWith('--limit=')) {
    const v = parseInt(a.split('=')[1], 10);
    if (!Number.isNaN(v) && v > 0) opts.limit = v;
  }
}

const mapInsuranceFromVariable = (variable) => {
  if (!variable || typeof variable !== 'object') return null;
  const v = variable;
  const provider = v.provider || v.insurance_provider || (v.insurance && v.insurance.provider) || '';
  const coverage = v.coverage_percentage ?? v.coverage ?? v.insurance?.coverage_percentage ?? v.insurance?.coverage ?? null;
  const policy_number = v.policy_number || v.policy || v.policyNo || '';
  const group_number = v.group_number || v.group || v.groupNo || '';
  const coverage_percentage = coverage == null ? null : Number(coverage);
  const hasAny = provider || (coverage_percentage !== null && !Number.isNaN(coverage_percentage)) || policy_number || group_number;
  if (!hasAny) return null;
  return {
    provider: provider || '',
    coverage_percentage: Number.isNaN(coverage_percentage) ? null : coverage_percentage,
    policy_number: policy_number || '',
    group_number: group_number || '',
  };
};

const run = async () => {
  console.log('Connecting to MongoDB...');
  await connectDB();

  const query = { variable: { $exists: true, $ne: null } };
  const cursor = PrescriptionInvoice.find(query).sort({ invoice_date: -1 }).cursor();

  let processed = 0;
  let updated = 0;
  let skipped = 0;

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    if (opts.limit && processed >= opts.limit) break;
    processed += 1;

    const invoice = doc.toObject();
    const insuranceFromVar = mapInsuranceFromVariable(invoice.variable || {});
    if (!insuranceFromVar) {
      skipped += 1;
      continue;
    }

    // Find patient by patient_id
    const patient = await Patient.findOne({ patient_id: invoice.patient_id });
    if (!patient) {
      console.warn(`No patient found for invoice_id=${invoice.invoice_id}, patient_id=${invoice.patient_id}`);
      skipped += 1;
      continue;
    }

    const existing = (patient.insurance && (patient.insurance.provider || patient.insurance.coverage_percentage || patient.insurance.policy_number || patient.insurance.group_number)) ? patient.insurance : null;

    if (existing && !opts.force) {
      // do not overwrite
      console.log(`Skipping patient ${patient.patient_id} (existing insurance present). Use --force to overwrite.`);
      skipped += 1;
      continue;
    }

    const update = {
      'insurance.provider': insuranceFromVar.provider || '',
      'insurance.coverage_percentage': insuranceFromVar.coverage_percentage == null ? 0 : insuranceFromVar.coverage_percentage,
      'insurance.policy_number': insuranceFromVar.policy_number || '',
      'insurance.group_number': insuranceFromVar.group_number || '',
      updated_by: 'seed-script',
    };

    if (opts.dryRun) {
      console.log(`[dry-run] Would update patient ${patient.patient_id} with`, update);
      updated += 1;
      continue;
    }

    await Patient.updateOne({ patient_id: patient.patient_id }, { $set: update });
    console.log(`Updated patient ${patient.patient_id} from invoice ${invoice.invoice_id}`);
    updated += 1;
  }

  console.log(`Done. Processed ${processed}, updated ${updated}, skipped ${skipped}`);
  process.exit(0);
};

run().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(2);
});
