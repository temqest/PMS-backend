#!/usr/bin/env node

require('dotenv').config();
const bcrypt = require('bcryptjs');
const connectDB = require('../src/config/db');
const User = require('../src/api/v1/auth/user.model');

// Get command line arguments
const [, , email, password, fullName] = process.argv;

if (!email || !password) {
  console.error('\x1b[31m%s\x1b[0m', '❌ Error: Email and password are required');
  console.log('\nUsage: node scripts/createAdmin.js <email> <password> [fullName]');
  console.log('Example: node scripts/createAdmin.js admin@clinic.com SecurePass123 "Admin User"\n');
  process.exit(1);
}

// Validate email format
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(email)) {
  console.error('\x1b[31m%s\x1b[0m', '❌ Error: Invalid email format');
  process.exit(1);
}

// Validate password strength (at least 8 characters)
if (password.length < 8) {
  console.error('\x1b[31m%s\x1b[0m', '❌ Error: Password must be at least 8 characters');
  process.exit(1);
}

const run = async () => {
  await connectDB();
  const passwordHash = bcrypt.hashSync(password, 8);

  const adminUser = await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    {
      $set: {
        email: email.toLowerCase(),
        password_hash: passwordHash,
        role: 'system_admin',
        fullName: fullName || email,
        patient_id: null,
        is_active: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log('\x1b[36m%s\x1b[0m', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\x1b[32m%s\x1b[0m', '✓ Admin User Upserted Successfully');
  console.log('\x1b[36m%s\x1b[0m', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('\x1b[33m%s\x1b[0m', 'Admin User Details:');
  console.log('───────────────────────────────────────────────────');
  console.log(`\x1b[36mID:\x1b[0m         ${String(adminUser._id)}`);
  console.log(`\x1b[36mEmail:\x1b[0m      ${adminUser.email}`);
  console.log(`\x1b[36mFull Name:\x1b[0m  ${adminUser.fullName || ''}`);
  console.log(`\x1b[36mRole:\x1b[0m       ${adminUser.role}`);
  console.log(`\x1b[36mActive:\x1b[0m     ${adminUser.is_active ? 'yes' : 'no'}`);
  console.log('\n\x1b[36m%s\x1b[0m', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  process.exit(0);
};

run().catch((err) => {
  console.error('\x1b[31m%s\x1b[0m', `❌ Error: ${err.message}`);
  process.exit(2);
});
