#!/usr/bin/env node
/*
  Backfill persistent auth users for all patients and export credentials.

  Usage:
    node scripts/seedPatientAuthUsers.js [--output=logs/patient-auth-credentials.csv] [--reset-passwords]
*/

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const connectDB = require('../src/config/db');
const Patient = require('../src/api/v1/patients/patient.model');
const User = require('../src/api/v1/auth/user.model');

const argv = process.argv.slice(2);
const opts = {
  output: 'logs/patient-auth-credentials.csv',
  resetPasswords: argv.includes('--reset-passwords'),
};

for (const arg of argv) {
  if (arg.startsWith('--output=')) {
    const value = arg.split('=').slice(1).join('=').trim();
    if (value) opts.output = value;
  }
}

const escapeCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const generatePassword = () => crypto.randomBytes(9).toString('base64url');

const run = async () => {
  console.log('Connecting to MongoDB...');
  await connectDB();

  const patients = await Patient.find({}).sort({ registration_date: 1 });
  if (!patients.length) {
    console.log('No patients found. Nothing to seed.');
    process.exit(0);
  }

  const rows = [['patient_id', 'email', 'plaintext_password', 'status']];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let skippedNoEmail = 0;

  for (const patient of patients) {
    const email = String(patient.email_address || '').trim().toLowerCase();
    if (!email) {
      skippedNoEmail += 1;
      rows.push([patient.patient_id, '', '', 'skipped_no_email']);
      continue;
    }

    const existing = await User.findOne({ email }).select('+password_hash');
    if (existing && !opts.resetPasswords) {
      skipped += 1;
      rows.push([patient.patient_id, email, '', 'existing_skipped']);
      continue;
    }

    const plaintextPassword = generatePassword();
    const passwordHash = bcrypt.hashSync(plaintextPassword, 8);
    const fullName = [patient.first_name, patient.last_name].filter(Boolean).join(' ').trim();
    const status = existing ? 'updated_password' : 'created';

    await User.findOneAndUpdate(
      { email },
      {
        $set: {
          email,
          password_hash: passwordHash,
          role: 'patient',
          patient_id: patient.patient_id,
          fullName,
          is_active: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (existing) updated += 1;
    else created += 1;
    rows.push([patient.patient_id, email, plaintextPassword, status]);
  }

  const absoluteOutput = path.isAbsolute(opts.output) ? opts.output : path.join(process.cwd(), opts.output);
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
  fs.writeFileSync(absoluteOutput, `${csv}\n`, 'utf8');

  console.log(`Done. created=${created}, updated=${updated}, skipped=${skipped}, skipped_no_email=${skippedNoEmail}`);
  console.log(`Credentials export written to: ${absoluteOutput}`);
  process.exit(0);
};

run().catch((err) => {
  console.error('Error seeding patient auth users:', err);
  process.exit(2);
});
