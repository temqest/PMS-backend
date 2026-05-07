#!/usr/bin/env node

require('dotenv').config();

const { auditRelationships, exportReport, printReport } = require('./lib/relationshipAudit');

async function main() {
  const report = await auditRelationships({ seedOnly: true });
  const exported = exportReport(report);

  printReport(report);
  console.log(`\nSeed validation report written to ${exported.reportPath}`);

  const hasIssues = Object.values(report.summary.issue_counts || {}).some((count) => count > 0);
  process.exit(hasIssues ? 2 : 0);
}

main().catch((err) => {
  console.error('Seed relationship validation failed:', err);
  process.exit(1);
});
