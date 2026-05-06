const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PERMISSIONS } = require('../../../config/constants');
const Patient = require('../patients/patient.model');
const patientService = require('../patients/patient.service');
const User = require('./user.model');
const AppError = require('../../../utils/AppError');

const toPublicUser = (user) => ({
  id: String(user._id),
  username: user.email,
  role: user.role,
  fullName: user.fullName || '',
  patient_id: user.patient_id || null,
  is_active: user.is_active,
  created_at: user.created_at,
});

exports.authenticate = async (username, password) => {
  const normalizedUsername = String(username || '').trim().toLowerCase();
  const user = await User.findOne({ email: normalizedUsername }).select('+password_hash');
  if (!user) return null;
  if (!user.is_active) throw new AppError('Account is not activated. Please contact support.', 403);
  const ok = await bcrypt.compare(password, user.password_hash);
  return ok ? toPublicUser(user) : null;
};

exports.generateToken = (user) => {
  const payload = {
    sub: user.id,
    role: user.role,
    patient_id: user.patient_id || null,
    fullName: user.fullName || '',
    scope: PERMISSIONS[user.role] || [],
  };
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
  });
};

// Find a user by email (username is used to store email)
exports.findByEmail = async (email) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });
  return user ? toPublicUser(user) : null;
};

// Register a new user in persistent store
exports.register = async ({ email, password, fullName, first_name, last_name, date_of_birth, gender, contact_number, address, national_id }) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const passwordHash = bcrypt.hashSync(password, 8);
  const patient = await Patient.findOne({ email_address: normalizedEmail });

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

  return toPublicUser(user);
};
