#!/usr/bin/env node
/**
 * Improved wrapper around scripts/seedTestData.js.
 *
 * This keeps the original seeder intact, but gives it safer defaults:
 * - larger cohort by default
 * - higher high-risk ratio by default
 * - predictive enrichment is off unless explicitly enabled
 *
 * Usage:
 *   node scripts/seedTestDataImproved.js --run
 *   node scripts/seedTestDataImproved.js --run --predictive
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const seedModule = require('./seedTestData.js');

function parseFlag(argv, flag) {
  return argv.includes(flag);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    console.log(`
Improved seeder wrapper

Options:
  --run         Execute the seed immediately
  --predictive  Allow predictive enrichment during seeding

Environment overrides:
  SEED_PATIENT_COUNT
  SEED_RANDOM_SEED
  SEED_WINDOW_MONTHS
  SEED_HIGH_RISK_COUNT
  SEED_RUN_PREDICTIVE
`);
    return;
  }

  if (!parseFlag(args, '--run')) {
    console.log('Run with: node scripts/seedTestDataImproved.js --run');
    console.log('Predictive enrichment is disabled by default to avoid ML service 404 noise.');
    return;
  }

  const patientCount = parseInt(process.env.SEED_PATIENT_COUNT || '60', 10);
  const seed = process.env.SEED_RANDOM_SEED || '42';
  const windowMonths = process.env.SEED_WINDOW_MONTHS || '20';
  const highRiskCount = process.env.SEED_HIGH_RISK_COUNT || String(Math.max(4, Math.floor(patientCount * 0.25)));
  const runPredictive = process.env.SEED_RUN_PREDICTIVE ?? (parseFlag(args, '--predictive') ? 'true' : 'false');

  process.env.SEED_PATIENT_COUNT = String(patientCount);
  process.env.SEED_RANDOM_SEED = String(seed);
  process.env.SEED_WINDOW_MONTHS = String(windowMonths);
  process.env.SEED_HIGH_RISK_COUNT = String(highRiskCount);
  process.env.SEED_RUN_PREDICTIVE = String(runPredictive);

  console.log('[SEED] Improved configuration');
  console.log(`[SEED] Patients: ${process.env.SEED_PATIENT_COUNT}`);
  console.log(`[SEED] High risk: ${process.env.SEED_HIGH_RISK_COUNT}`);
  console.log(`[SEED] Window months: ${process.env.SEED_WINDOW_MONTHS}`);
  console.log(`[SEED] Predictive: ${String(process.env.SEED_RUN_PREDICTIVE).toLowerCase() !== 'false'}`);

  await seedModule.connectDB();
  await seedModule.seedDatabase({
    patientCount: Number(process.env.SEED_PATIENT_COUNT),
    seed: process.env.SEED_RANDOM_SEED,
    windowMonths: process.env.SEED_WINDOW_MONTHS,
    runPredictive: process.env.SEED_RUN_PREDICTIVE,
  });
}

main().catch((err) => {
  console.error('[SEED] Improved seeding failed:', err);
  process.exitCode = 1;
});
