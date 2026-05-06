const { PERMISSIONS } = require('../config/constants');
const AppError = require('../utils/AppError');

exports.allow = (...requiredPermissions) => (req, res, next) => {
  if (req.user?.role === 'system_admin') {
    return next();
  }

  const userPermissions = PERMISSIONS[req.user?.role] || [];
  // allow if user has ANY of the required permissions
  const hasAccess = requiredPermissions.some((p) => userPermissions.includes(p));
  if (!hasAccess) {
    throw new AppError(
      `Role '${req.user?.role}' lacks permission: ${requiredPermissions.join(', ')}`,
      403
    );
  }
  next();
};
