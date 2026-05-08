const asyncHandler = require('../../../utils/asyncHandler');
const mongoose = require('mongoose');
const authService = require('./auth.service');
const AppError = require('../../../utils/AppError');
const apiResponse = require('../../../utils/apiResponse');
const auditService = require('../audit-logs/auditLog.service');
const { getLocalAccessProfile } = require('./localPermissions');

const normalizeLoginType = (value) => {
  const normalized = String(value || '').trim().replace(/[-\s]+/g, '_').toLowerCase();
  if (['patient', 'local_patient', 'local'].includes(normalized)) return 'patient';
  if (['admin', 'staff', 'doctor', 'care_team', 'external', 'admin_subsystem'].includes(normalized)) return 'admin';
  return '';
};

const isActiveClaim = (user) => String(user?.status || '').toLowerCase() === 'active';

const isExternalAuthClaim = (user) => {
  const role = String(user?.role || '').toLowerCase();
  return Boolean(user?.user_id && user?.username && role && role !== 'patient');
};

const publicExternalUserFromClaims = (user) => ({
  id: user.user_id || user.sub,
  user_id: user.user_id || user.sub,
  username: user.username || '',
  role: user.role,
  subsystem: user.subsystem || 'Patient',
  status: user.status || 'active',
  authType: user.authType || 'admin',
  permissions: Array.isArray(user.permissions) ? user.permissions : getLocalAccessProfile(user.role)?.permissions,
  services: user.services || getLocalAccessProfile(user.role)?.services,
});

exports.login = asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  const loginType = normalizeLoginType(req.body?.auth_type || req.body?.login_type || req.body?.loginType);
  if (!username || !password) {
    await auditService.logAuditEvent({
      actor_user_id: null,
      actor_name: String(username || '').trim().toLowerCase(),
      actor_role: '',
      action: 'LOGIN_FAILED',
      entity_type: 'auth',
      entity_id: String(username || '').trim().toLowerCase(),
      description: 'Login attempt missing username or password.',
      ip_address: req.ip,
      user_agent: req.get('user-agent') || '',
    });
    throw new AppError('username and password are required', 400);
  }

  let user;
  let adminAccessToken;
  try {
    if (loginType === 'patient') {
      user = await authService.authenticate(username, password);
      if (user && user.role !== 'patient') {
        user = null;
      }
    } else if (process.env.NODE_ENV === 'test' && !authService.isAdminSubsystemConfigured()) {
      user = await authService.authenticate(username, password);
    } else {
      const result = await authService.authenticateWithAdminSubsystem(username, password);
      user = result.user;
      adminAccessToken = result.adminAccessToken;
    }
  } catch (err) {
    await auditService.logAuditEvent({
      actor_user_id: null,
      actor_name: String(username || '').trim().toLowerCase(),
      actor_role: '',
      action: 'LOGIN_FAILED',
      entity_type: 'auth',
      entity_id: String(username || '').trim().toLowerCase(),
      description: err.message || 'Login failed.',
      ip_address: req.ip,
      user_agent: req.get('user-agent') || '',
    });
    throw err;
  }

  if (!user) {
    await auditService.logAuditEvent({
      actor_user_id: null,
      actor_name: String(username || '').trim().toLowerCase(),
      actor_role: '',
      action: 'LOGIN_FAILED',
      entity_type: 'auth',
      entity_id: String(username || '').trim().toLowerCase(),
      description: 'Invalid credentials.',
      ip_address: req.ip,
      user_agent: req.get('user-agent') || '',
    });
    throw new AppError('Invalid credentials', 401);
  }

  const accessToken = authService.generateToken(user);
  const userId = user.user_id || user.id;
  await auditService.logAuditEvent({
    actor: { id: userId, name: user.fullName || user.username, role: user.role, ip: req.ip, user_agent: req.get('user-agent') || '' },
    action: 'LOGIN_SUCCESS',
    entity_type: 'user',
    entity_id: userId,
    entity_name: user.fullName || user.username,
    description: 'User logged in.',
  });
  apiResponse.success(res, 200, {
    accessToken,
    token: accessToken,
    ...(adminAccessToken ? { adminAccessToken } : {}),
    user: {
      id: userId,
      user_id: userId,
      username: user.username,
      role: user.role,
      subsystem: user.subsystem || 'Patient',
      status: user.status || (user.is_active === false ? 'inactive' : 'active'),
      authType: user.authType || (user.role === 'patient' ? 'patient' : 'admin'),
      ...(Array.isArray(user.permissions) ? { permissions: user.permissions } : {}),
      ...(user.services ? { services: user.services } : {}),
    },
  });
});

exports.register = asyncHandler(async (req, res) => {
  const {
    email,
    password,
    fullName,
    first_name,
    last_name,
    date_of_birth,
    gender,
    contact_number,
    address,
    national_id,
  } = req.body || {};
  if (!email || !password) throw new AppError('email and password are required', 400);

  const existing = await authService.findByEmail(email);
  if (existing) throw new AppError('User already exists', 409);

  const user = await authService.register({
    email,
    password,
    fullName,
    first_name,
    last_name,
    date_of_birth,
    gender,
    contact_number,
    address,
    national_id,
  });

  await auditService.logAuditEvent({
    actor: { id: user.id, name: user.fullName || user.username, role: user.role, ip: req.ip, user_agent: req.get('user-agent') || '' },
    action: 'REGISTER_USER',
    entity_type: 'user',
    entity_id: user.id,
    entity_name: user.fullName || user.username,
    description: 'User registered and is pending activation.',
    new_value: user,
  });

  const token = authService.generateToken(user);
  apiResponse.success(res, 201, { token, user: { id: user.id, email: user.username, fullName: user.fullName, role: user.role, patient_id: user.patient_id, is_active: user.is_active } });
});

exports.getPendingUsers = asyncHandler(async (req, res) => {
  const users = await authService.getPendingUsers();
  apiResponse.success(res, 200, { users });
});

exports.getAllUsers = asyncHandler(async (req, res) => {
  const users = await authService.getAllUsers();
  apiResponse.success(res, 200, { users });
});

exports.activateUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!userId) throw new AppError('userId is required', 400);

  const user = await authService.activateUser(userId);
  await auditService.logAuditEvent({
    actor: auditService.buildActorFromRequest(req),
    action: 'ACTIVATE_USER',
    entity_type: 'user',
    entity_id: user.id,
    entity_name: user.fullName || user.username,
    description: 'User account activated.',
    new_value: user,
  });
  apiResponse.success(res, 200, { user, message: 'User account activated successfully' });
});

exports.deactivateUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!userId) throw new AppError('userId is required', 400);

  const user = await authService.deactivateUser(userId);
  await auditService.logAuditEvent({
    actor: auditService.buildActorFromRequest(req),
    action: 'DEACTIVATE_USER',
    entity_type: 'user',
    entity_id: user.id,
    entity_name: user.fullName || user.username,
    description: 'User account deactivated.',
    new_value: user,
  });
  apiResponse.success(res, 200, { user, message: 'User account deactivated successfully' });
});

exports.getMe = asyncHandler(async (req, res) => {
  const userId = req.user?.sub;
  if (!userId) throw new AppError('Unauthorized', 401);

  if (isExternalAuthClaim(req.user)) {
    if (!isActiveClaim(req.user)) {
      throw new AppError('Account is not active. Unauthorized.', 401);
    }

    if (!mongoose.Types.ObjectId.isValid(String(userId))) {
      apiResponse.success(res, 200, { user: publicExternalUserFromClaims(req.user) });
      return;
    }
  }

  const user = await authService.getCurrentUserById(String(userId));
  if (!user) {
    if (isExternalAuthClaim(req.user)) {
      apiResponse.success(res, 200, { user: publicExternalUserFromClaims(req.user) });
      return;
    }
    throw new AppError('User not found', 404);
  }
  if (user.is_active === false) throw new AppError('Account is not active. Unauthorized.', 401);

  apiResponse.success(res, 200, { user });
});

exports.logout = asyncHandler(async (req, res) => {
  await auditService.logAuditEvent({
    actor: auditService.buildActorFromRequest(req),
    action: 'LOGOUT',
    entity_type: 'user',
    entity_id: req.user?.sub,
    entity_name: req.user?.fullName || '',
    description: 'User logged out.',
  });

  apiResponse.success(res, 200, { logged_out: true });
});
