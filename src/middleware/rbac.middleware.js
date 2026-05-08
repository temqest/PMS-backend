const { PERMISSIONS } = require('../config/constants');
const AppError = require('../utils/AppError');
const auditService = require('../api/v1/audit-logs/auditLog.service');

exports.allow = (...requiredPermissions) => async (req, res, next) => {
  if (req.user?.role === 'system_admin') {
    return next();
  }

  const userPermissions = PERMISSIONS[req.user?.role] || [];
  // allow if user has ANY of the required permissions
  const hasAccess = requiredPermissions.some((p) => userPermissions.includes(p));
  if (!hasAccess) {
    await auditService.logAuditEvent({
      actor: auditService.buildActorFromRequest(req),
      action: 'UNAUTHORIZED_ACCESS',
      entity_type: 'auth',
      description: `Role '${req.user?.role}' lacked permission '${requiredPermissions.join(', ')}' for ${req.method} ${req.originalUrl || req.url}.`,
      subsystem: 'Auth',
    });
    return next(new AppError(
      `Role '${req.user?.role}' lacks permission: ${requiredPermissions.join(', ')}`,
      403
    ));
  }
  return next();
};
