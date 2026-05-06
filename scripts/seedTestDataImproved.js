#!/usr/bin/env node

const { runFromCli } = require('./seedTestData');

console.warn('[SEED] seedTestDataImproved.js is deprecated. Forwarding to the unified seed workflow.');

runFromCli(process.argv.slice(2)).catch((err) => {
  console.error('[SEED] Unified seeding failed:', err);
  process.exitCode = 1;
});
