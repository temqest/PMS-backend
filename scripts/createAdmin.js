#!/usr/bin/env node

/**
 * Script to create an admin user for testing/development
 * Usage: node scripts/createAdmin.js <email> <password> [fullName]
 * Example: node scripts/createAdmin.js admin@clinic.com SecurePass123 "Admin User"
 */

const bcrypt = require('bcryptjs');

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

// Hash the password
const passwordHash = bcrypt.hashSync(password, 8);

// Create admin user object
const adminUser = {
  id: Date.now().toString(),
  username: email,
  passwordHash,
  role: 'system_admin',
  fullName: fullName || email,
};

console.log('\x1b[36m%s\x1b[0m', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('\x1b[32m%s\x1b[0m', '✓ Admin User Created Successfully');
console.log('\x1b[36m%s\x1b[0m', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('\x1b[33m%s\x1b[0m', 'Admin User Details:');
console.log('───────────────────────────────────────────────────');
console.log(`\x1b[36mID:\x1b[0m         ${adminUser.id}`);
console.log(`\x1b[36mEmail:\x1b[0m      ${adminUser.username}`);
console.log(`\x1b[36mFull Name:\x1b[0m  ${adminUser.fullName}`);
console.log(`\x1b[36mRole:\x1b[0m       ${adminUser.role}`);
console.log(`\x1b[36mPermissions:\x1b[0m register, view, update, soft_delete, analytics`);

console.log('\n\x1b[33m%s\x1b[0m', 'To add to your auth.service.js:');
console.log('───────────────────────────────────────────────────');
console.log('Add this object to the users array in src/api/v1/auth/auth.service.js:\n');
console.log('\x1b[32m%s\x1b[0m', JSON.stringify(adminUser, null, 2));

console.log('\n\x1b[36m%s\x1b[0m', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
