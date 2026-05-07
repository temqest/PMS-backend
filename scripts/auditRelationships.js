#!/usr/bin/env node

require('dotenv').config();

const { auditRelationships, exportReport, printReport } = require('./lib/relationshipAudit');

const argv = process.argv.slice(2);
const options = {
  seedOnly: argv.includes('--seed-only'),
};

async function main() {
  const report = await auditRelationships(options);
  const exported = exportReport(report);

  printReport(report);
  console.log(`\nAudit report written to ${exported.reportPath}`);

  const hasIssues = Object.values(report.summary.issue_counts || {}).some((count) => count > 0);
  process.exit(hasIssues ? 2 : 0);
}

main().catch((err) => {
  console.error('Relationship audit failed:', err);
  process.exit(1);
});
