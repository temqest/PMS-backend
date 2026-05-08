const bcrypt = require('bcryptjs');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { PERMISSIONS } = require('../../../config/constants');
const { getLocalAccessProfile, normalizeRoleKey } = require('./localPermissions');
const Patient = require('../patients/patient.model');
const patientService = require('../patients/patient.service');
const User = require('./user.model');
const AppError = require('../../../utils/AppError');

const ADMIN_LOGIN_PATH = '/admin/api/auth/subsystem-login';

const roleAliases = {
  admin: 'system_admin',
  administrator: 'system_admin',
  system_admin: 'system_admin',
  systemadmin: 'system_admin',
  'system admin': 'system_admin',
  staff: 'front_desk',
  front_desk: 'front_desk',
  frontdesk: 'front_desk',
  'front desk': 'front_desk',
  receptionist: 'front_desk',
  doctor: 'physician',
  physician: 'physician',
  billing_system: 'billing_system',
  'billing system': 'billing_system',
  appointment_system: 'appointment_system',
  'appointment system': 'appointment_system',
  emr_system: 'emr_system',
  'emr system': 'emr_system',
  predictive_analytics: 'predictive_analytics',
  'predictive analytics': 'predictive_analytics',
  patient: 'patient',
};

const normalizeRole = (role) => {
  const raw = String(role || '').trim().toLowerCase();
  const normalized = raw.replace(/[^a-z0-9]+/g, ' ').trim();
  const underscored = normalized.replace(/\s+/g, '_');
  return roleAliases[raw] || roleAliases[normalized] || roleAliases[underscored] || normalizeRoleKey(raw);
};

const normalizeAdminBaseUrl = (value) => {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return raw.endsWith(ADMIN_LOGIN_PATH) ? raw.slice(0, -ADMIN_LOGIN_PATH.length) : raw;
};

const isActiveStatus = (status) => String(status || '').trim().toLowerCase() === 'active';

const toExternalPublicUser = (user) => ({
  id: String(user.user_id || '').trim(),
  user_id: String(user.user_id || '').trim(),
  username: String(user.username || '').trim(),
  role: normalizeRole(user.role),
  subsystem: String(user.subsystem || '').trim(),
  status: String(user.status || '').trim().toLowerCase(),
  authType: 'admin',
});

const getResponseMessage = (data) => {
  if (!data || typeof data !== 'object') return '';
  return String(data.message || data.error || data.detail || '').trim();
};

const toPublicUser = (user) => ({
  id: String(user._id),
  user_id: String(user._id),
  username: user.email,
  role: user.role,
  status: user.is_active ? 'active' : 'inactive',
  fullName: user.fullName || '',
  patient_id: user.patient_id || null,
  is_active: user.is_active,
  created_at: user.created_at,
  authType: user.role === 'patient' ? 'patient' : 'admin',
});

const enrichUserWithLocalAccess = (user) => {
  const accessProfile = getLocalAccessProfile(user?.role);
  if (!accessProfile) return user;

  return {
    ...user,
    permissions: Array.from(new Set([...(Array.isArray(user.permissions) ? user.permissions : []), ...accessProfile.permissions])),
    services: {
      ...accessProfile.services,
      ...(user.services && typeof user.services === 'object' ? user.services : {}),
    },
  };
};

exports.authenticate = async (username, password) => {
  const normalizedUsername = String(username || '').trim().toLowerCase();
  const user = await User.findOne({ email: normalizedUsername }).select('+password_hash');
  if (!user) return null;
  if (!user.is_active) throw new AppError('Account is not activated. Please contact support.', 403);
  const ok = await bcrypt.compare(password, user.password_hash);
  return ok ? toPublicUser(user) : null;
};

exports.generateToken = (user) => {
  const accessProfile = getLocalAccessProfile(user?.role);
  const payload = {
    sub: user.user_id || user.id,
    user_id: user.user_id || user.id,
    username: user.username || '',
    role: user.role,
    subsystem: user.subsystem || 'Patient',
    status: user.status || (user.is_active === false ? 'inactive' : 'active'),
    authType: user.authType || (user.role === 'patient' ? 'patient' : 'admin'),
    patient_id: user.patient_id || null,
    fullName: user.fullName || '',
    scope: PERMISSIONS[user.role] || [],
    permissions: user.permissions || accessProfile?.permissions,
    services: user.services || accessProfile?.services,
  };
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
  });
};

exports.isAdminSubsystemConfigured = () => Boolean(normalizeAdminBaseUrl(process.env.ADMIN_SYSTEM_URL) && process.env.SUBSYSTEM_API_KEY);

exports.authenticateWithAdminSubsystem = async (username, password) => {
  const adminBaseUrl = normalizeAdminBaseUrl(process.env.ADMIN_SYSTEM_URL);
  const subsystemKey = process.env.SUBSYSTEM_API_KEY;

  if (!adminBaseUrl || !subsystemKey) {
    throw new AppError('Admin subsystem authentication is not configured.', 500);
  }

  let response;
  try {
    response = await axios.post(
      `${adminBaseUrl}${ADMIN_LOGIN_PATH}`,
      {
        username: String(username || '').trim(),
        password,
        subsystem: 'Patient',
      },
      {
        timeout: Number(process.env.ADMIN_SYSTEM_TIMEOUT_MS || 10000),
        headers: {
          'Content-Type': 'application/json',
          'X-Subsystem-Key': subsystemKey,
        },
        validateStatus: () => true,
      }
    );
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      throw new AppError('Admin subsystem login timed out. Please try again.', 504);
    }
    throw new AppError('Admin subsystem unavailable. Please try again later.', 503);
  }

  const { status, data } = response;
  if (status < 200 || status >= 300) {
    const message = getResponseMessage(data).toLowerCase();
    if (status === 400 || status === 401) {
      throw new AppError('Invalid username or password.', 401);
    }
    if (status === 403 && message.includes('inactive')) {
      throw new AppError('Account is inactive. Please contact support.', 403);
    }
    if (status === 403) {
      throw new AppError('Admin subsystem rejected the login request.', 502);
    }
    if (status === 408 || status === 504) {
      throw new AppError('Admin subsystem login timed out. Please try again.', 504);
    }
    throw new AppError('Admin subsystem unavailable. Please try again later.', 503);
  }

  const payload = data && typeof data === 'object' && data.data && typeof data.data === 'object'
    ? data.data
    : data;
  const accessToken = payload && typeof payload === 'object' ? payload.accessToken || payload.token : '';
  const user = payload && typeof payload === 'object' ? payload.user : null;
  const publicUser = user && typeof user === 'object' ? toExternalPublicUser(user) : null;

  if (!accessToken || !publicUser?.user_id || !publicUser.username || !publicUser.role || !publicUser.subsystem || !publicUser.status) {
    throw new AppError('Admin subsystem returned an invalid login response.', 502);
  }

  if (!isActiveStatus(publicUser.status)) {
    throw new AppError('Account is inactive. Please contact support.', 403);
  }

  return {
    adminAccessToken: accessToken,
    user: enrichUserWithLocalAccess(publicUser),
  };
};

// Find a user by email (username is used to store email)
exports.findByEmail = async (email) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });
  return user ? enrichUserWithLocalAccess(toPublicUser(user)) : null;
};

// Register a new user in persistent store
exports.register = async ({ email, password, fullName, first_name, last_name, date_of_birth, gender, contact_number, address, national_id }) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const passwordHash = bcrypt.hashSync(password, 8);
  const matchingPatients = await Patient.find({ email_address: normalizedEmail }).limit(2);
  if (matchingPatients.length > 1) {
    throw new AppError('Multiple patient profiles share this email address. Manual review is required before creating a user account.', 409);
  }
  const patient = matchingPatients[0] || null;

  let patientRecord = patient;
  if (!patientRecord) {
    const derivedName = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    const inferredFirstName = String(first_name || derivedName[0] || '').trim();
    const inferredLastName = String(last_name || derivedName.slice(1).join(' ') || '').trim();

    if (!inferredFirstName || !inferredLastName || !date_of_birth || !gender || !contact_number || !address) {
      throw new AppError('first_name, last_name, date_of_birth, gender, contact_number, and address are required to create a patient record.', 400);
    }

    patientRecord = await patientService.registerPatient(
      {
        first_name: inferredFirstName,
        last_name: inferredLastName,
        date_of_birth,
        gender,
        contact_number,
        email_address: normalizedEmail,
        address,
        national_id,
      },
      { id: 'system', role: 'patient' }
    );
  }

  const newUser = await User.create({
    email: normalizedEmail,
    password_hash: passwordHash,
    role: 'patient',
    fullName: fullName || '',
    patient_id: patientRecord ? patientRecord.patient_id : null,
    is_active: false,
  });
  return { ...toPublicUser(newUser), patient: patientRecord || null };
};

// Get pending (inactive) users
exports.getPendingUsers = async () => {
  const users = await User.find({ role: 'patient', is_active: false }).sort({ created_at: -1 });
  return users.map((u) => toPublicUser(u));
};

// Activate a user account
exports.activateUser = async (userId) => {
  const user = await User.findByIdAndUpdate(userId, { $set: { is_active: true } }, { returnDocument: 'after' });
  if (!user) throw new AppError('User not found', 404);
  return toPublicUser(user);
};

// Deactivate a user account
exports.deactivateUser = async (userId) => {
  const user = await User.findByIdAndUpdate(userId, { $set: { is_active: false } }, { returnDocument: 'after' });
  if (!user) throw new AppError('User not found', 404);
  return toPublicUser(user);
};

// Get all users (for admin)
exports.getAllUsers = async () => {
  const users = await User.find({}).sort({ created_at: -1 });
  return users.map((u) => toPublicUser(u));
};

exports.getCurrentUserById = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return null;

  return enrichUserWithLocalAccess(toPublicUser(user));
};
