#!/usr/bin/env node

require('dotenv').config();

const { auditRelationships, applyRepairs, exportReport, printReport } = require('./lib/relationshipAudit');

const argv = process.argv.slice(2);
const options = {
  apply: argv.includes('--apply'),
  seedOnly: argv.includes('--seed-only'),
};

async function main() {
  const report = await auditRelationships({ seedOnly: options.seedOnly });
  const exported = exportReport(report);

  printReport(report);
  console.log(`\nAudit report written to ${exported.reportPath}`);

  const result = await applyRepairs(report, { apply: options.apply });
  if (!options.apply) {
    console.log(`\nDry run only. Backup snapshot written to ${result.backupPath}`);
    process.exit(0);
  }

  console.log(`\nApplied ${result.applied_repairs.length} high-confidence repairs.`);
  console.log(`Backup snapshot written to ${result.backupPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Relationship repair failed:', err);
  process.exit(1);
});
