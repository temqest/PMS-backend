const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const connectDB = require('../src/config/db');
const AuditLog = require('../src/api/v1/audit-logs/auditLog.model');

const DEFAULT_LOG_PATH = path.join(process.cwd(), 'logs', 'audit.log');
const BATCH_SIZE = 500;

const parseArgs = (argv = process.argv.slice(2)) => {
  const options = {
    file: DEFAULT_LOG_PATH,
    dryRun: false,
  };

  argv.forEach((arg) => {
    if (arg === '--dry-run') {
      options.dryRun = true;
      return;
    }

    if (arg.startsWith('--file=')) {
      const value = arg.slice('--file='.length).trim();
      if (value) {
        options.file = path.isAbsolute(value) ? value : path.join(process.cwd(), value);
      }
    }
  });

  return options;
};

const signatureFor = (doc = {}) =>
  crypto
    .createHash('sha1')
    .update(JSON.stringify({
      user_id: doc.user_id || null,
      action_type: doc.action_type || '',
      details: doc.details || '',
      ip_addr: doc.ip_addr || '',
      subsystem: doc.subsystem || '',
      created_at: doc.created_at instanceof Date ? doc.created_at.toISOString() : String(doc.created_at || ''),
    }))
    .digest('hex');

const humanizeEvent = (event = '') =>
  String(event)
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const inferSubsystem = (event = '') => {
  const normalized = String(event || '').trim().toUpperCase();
  if (normalized.startsWith('PATIENT') || normalized.includes('MEDICAL_HISTORY')) return 'Patient';
  if (normalized.startsWith('APPOINTMENT')) return 'Appointment';
  if (normalized.startsWith('HEALTH_RECORD')) return 'Health Record';
  if (normalized.startsWith('PRESCRIPTION_INVOICE')) return 'Prescription Invoice';
  if (normalized.startsWith('PRESCRIPTION')) return 'Prescription';
  if (normalized.startsWith('API_KEY')) return 'API Key';
  if (normalized.startsWith('LOGIN') || normalized.startsWith('LOGOUT') || normalized.startsWith('REGISTER') || normalized.includes('USER')) return 'Auth';
  return 'System';
};

const buildLegacyDetails = (event, message = {}) => {
  const fragments = [humanizeEvent(event)];
  if (message.patient_id) fragments.push(`patient=${message.patient_id}`);
  if (message.appointment_id) fragments.push(`appointment=${message.appointment_id}`);
  if (message.record_id) fragments.push(`record=${message.record_id}`);
  if (message.invoice_id) fragments.push(`invoice=${message.invoice_id}`);
  if (message.results !== undefined) fragments.push(`results=${message.results}`);
  if (message.status) fragments.push(`status=${message.status}`);
  if (message.is_released !== undefined) fragments.push(`released=${message.is_released}`);
  if (message.total_amount !== undefined) fragments.push(`total=${message.total_amount}`);
  if (message.appointmentRef) fragments.push(`appointment_ref=${message.appointmentRef}`);
  return fragments.join(' | ');
};

const mapLegacyLogToAuditDoc = (linePayload = {}) => {
  const message = linePayload && typeof linePayload.message === 'object' ? linePayload.message : {};
  const event = String(message.event || linePayload.event || '').trim().toUpperCase();
  if (!event) return null;

  const createdAt = new Date(linePayload.timestamp || Date.now());
  if (Number.isNaN(createdAt.getTime())) return null;

  return {
    user_id: message.actor_id ? String(message.actor_id) : null,
    action_type: event,
    details: buildLegacyDetails(event, message),
    ip_addr: message.ip ? String(message.ip) : '',
    subsystem: inferSubsystem(event),
    created_at: createdAt,
  };
};

const loadExistingSignatures = async () => {
  const existing = await AuditLog.find({})
    .select('user_id action_type details ip_addr subsystem created_at')
    .lean();

  return new Set(existing.map((item) => signatureFor(item)));
};

const flushBatch = async (batch, dryRun) => {
  if (!batch.length) return 0;
  if (dryRun) return batch.length;
  await AuditLog.insertMany(batch, { ordered: false });
  return batch.length;
};

const importAuditLog = async ({ file, dryRun }) => {
  if (!fs.existsSync(file)) {
    throw new Error(`Audit log file not found: ${file}`);
  }

  const existingSignatures = dryRun ? new Set() : (await connectDB(), await loadExistingSignatures());
  const seenSignatures = new Set(existingSignatures);

  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let processed = 0;
  let parsed = 0;
  let skipped = 0;
  let inserted = 0;
  let batch = [];

  for await (const line of rl) {
    processed += 1;
    const trimmed = String(line || '').trim();
    if (!trimmed) {
      skipped += 1;
      continue;
    }

    let payload;
    try {
      payload = JSON.parse(trimmed);
    } catch (err) {
      skipped += 1;
      continue;
    }

    const doc = mapLegacyLogToAuditDoc(payload);
    if (!doc) {
      skipped += 1;
      continue;
    }

    parsed += 1;
    const signature = signatureFor(doc);
    if (seenSignatures.has(signature)) {
      skipped += 1;
      continue;
    }

    seenSignatures.add(signature);
    batch.push(doc);

    if (batch.length >= BATCH_SIZE) {
      inserted += await flushBatch(batch, dryRun);
      batch = [];
    }
  }

  inserted += await flushBatch(batch, dryRun);

  return { file, processed, parsed, inserted, skipped, dryRun };
};

const run = async () => {
  const options = parseArgs();
  try {
    const result = await importAuditLog(options);
    console.log(`Audit log import ${result.dryRun ? 'dry run' : 'completed'} for ${result.file}`);
    console.log(`Processed: ${result.processed}`);
    console.log(`Parsed: ${result.parsed}`);
    console.log(`Inserted: ${result.inserted}`);
    console.log(`Skipped: ${result.skipped}`);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  } catch (err) {
    console.error(`Audit log import failed: ${err.message}`);
    process.exitCode = 1;
  }
};

module.exports = {
  buildLegacyDetails,
  importAuditLog,
  inferSubsystem,
  mapLegacyLogToAuditDoc,
  parseArgs,
  signatureFor,
};

if (require.main === module) {
  run();
}
