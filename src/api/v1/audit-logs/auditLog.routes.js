const express = require('express');

const ctrl = require('./auditLog.controller');
const { protect } = require('../../../middleware/auth.middleware');
const { allow } = require('../../../middleware/rbac.middleware');
const { validate, validatePart } = require('../../../middleware/validate.middleware');
const { auditLogQuerySchema, telehealthAuditEventSchema } = require('./auditLog.validation');

const router = express.Router();

router.use(protect);

router.post('/events/telehealth', validate(telehealthAuditEventSchema), ctrl.recordTelehealthEvent);

router.get('/', allow('view:audit_logs'), validatePart(auditLogQuerySchema, 'query'), ctrl.getAuditLogs);
router.get('/:id', allow('view:audit_logs'), ctrl.getAuditLogById);

module.exports = router;
