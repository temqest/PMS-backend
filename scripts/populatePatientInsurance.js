#!/usr/bin/env node
/*
  Populate patient.insurance with sample providers and coverage percentages.

  Usage:
    node scripts/populatePatientInsurance.js [--dry-run] [--force] [--limit=N]

  --dry-run : show changes without applying
  --force   : overwrite existing insurance entries
  --limit=N : maximum patients to process
*/

require('dotenv').config();
const connectDB = require('../src/config/db');
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

const PROVIDERS = [
  'HealthFirst Ins.',
  'Medicare Plus',
  'CareShield',
  'WellCover Health',
  'Global Health Assure',
  'FamilyHealth Insurance',
  'PremierCare',
  'Unity Health Cover',
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randCoverage = () => [50, 60, 70, 75, 80, 85, 90, 95, 100][Math.floor(Math.random() * 9)];
const randPolicy = () => `POL-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const randGroup = () => `GRP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const run = async () => {
  console.log('Connecting to MongoDB...');
  await connectDB();

  const cursor = Patient.find({}).sort({ registration_date: -1 }).cursor();
  let processed = 0;
  let updated = 0;
  let skipped = 0;

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    if (opts.limit && processed >= opts.limit) break;
    processed += 1;

    const patient = doc;
    const hasInsurance = patient.insurance && (patient.insurance.provider || patient.insurance.policy_number);
    if (hasInsurance && !opts.force) {
      skipped += 1;
      continue;
    }

    const newInsurance = {
      provider: pick(PROVIDERS),
      coverage_percentage: randCoverage(),
      policy_number: randPolicy(),
      group_number: randGroup(),
    };

    if (opts.dryRun) {
      console.log(`[dry-run] Would set insurance for ${patient.patient_id}:`, newInsurance);
      updated += 1;
      continue;
    }

    await Patient.updateOne({ patient_id: patient.patient_id }, { $set: { insurance: newInsurance, updated_by: 'seed-populate' } });
    console.log(`Updated patient ${patient.patient_id} with insurance ${newInsurance.provider} (${newInsurance.coverage_percentage}%)`);
    updated += 1;
  }

  console.log(`Done. Processed ${processed}, updated ${updated}, skipped ${skipped}`);
  process.exit(0);
};

run().catch((err) => {
  console.error('Error populating patient insurance:', err);
  process.exit(2);
});
