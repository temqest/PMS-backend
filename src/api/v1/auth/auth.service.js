const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PERMISSIONS } = require('../../../config/constants');

// Simple in-memory user store for Phase 2 (replace with DB in Phase 3)
const users = [
  {
    id: '1',
    username: 'admin',
    passwordHash: bcrypt.hashSync('password', 8),
    role: 'system_admin',
  },
  {
    id: '1777432837989',
    username: 'admin@clinic.com',
    passwordHash: '$2b$08$5EjsCxIX0FghNtjgOPnh0.9tvVC47I4Cygi0nURner7nqSrErU9s.',
    role: 'system_admin',
    fullName: 'Admin User',
  },
];

exports.authenticate = async (username, password) => {
  const user = users.find((u) => u.username === username);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? { id: user.id, username: user.username, role: user.role } : null;
};

exports.generateToken = (user) => {
  const payload = {
    sub: user.id,
    role: user.role,
    scope: PERMISSIONS[user.role] || [],
  };
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
  });
};

// Find a user by email (username is used to store email)
exports.findByEmail = async (email) => {
  return users.find((u) => u.username === email) || null;
};

// Register a new user in the in-memory store
exports.register = async ({ email, password, fullName }) => {
  const id = Date.now().toString();
  const passwordHash = bcrypt.hashSync(password, 8);
  const newUser = {
    id,
    username: email,
    passwordHash,
    role: 'user',
    fullName: fullName || '',
  };
  users.push(newUser);
  return { id: newUser.id, username: newUser.username, role: newUser.role, fullName: newUser.fullName };
};
