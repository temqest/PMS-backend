const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const User = require('../api/v1/auth/user.model');
const auditService = require('../api/v1/audit-logs/auditLog.service');

const auditUnauthorizedAccess = async (req, description, userId = null) => {
  await auditService.logAuditEvent({
    user_id: userId,
    action: 'UNAUTHORIZED_ACCESS',
    entity_type: 'auth',
    description: `${description} ${req.method} ${req.originalUrl || req.url}`,
    ip_address: req.ip,
    subsystem: 'Auth',
  });
};

exports.protect = asyncHandler(async (req, res, next) => {
  let token;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer')) token = auth.split(' ')[1];

  if (!token) {
    await auditUnauthorizedAccess(req, 'Missing bearer token for');
    throw new AppError('No token provided. Unauthorized.', 401);
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    await auditUnauthorizedAccess(req, 'Invalid bearer token for');
    throw err;
  }
  if (decoded?.status && String(decoded.status).toLowerCase() !== 'active') {
    await auditUnauthorizedAccess(req, 'Inactive token attempted access to', decoded.sub || decoded.user_id || null);
    throw new AppError('Account is not active. Unauthorized.', 401);
  }

  if (decoded?.sub && mongoose.Types.ObjectId.isValid(String(decoded.sub))) {
    const user = await User.findById(decoded.sub).select('is_active');
    if (user && !user.is_active) {
      await auditUnauthorizedAccess(req, 'Inactive account attempted access to', decoded.sub);
      throw new AppError('Account is not active. Unauthorized.', 401);
    }
  }
  req.user = decoded;
  next();
});
