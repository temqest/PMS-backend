const express = require('express');
const router = express.Router();
const ctrl = require('./healthRecord.controller');
const { validate } = require('../../../middleware/validate.middleware');
const { protect } = require('../../../middleware/auth.middleware');
const { allow } = require('../../../middleware/rbac.middleware');
const rateLimiter = require('../../../middleware/rateLimiter');
const {
  createHealthRecordSchema,
  updateHealthRecordSchema,
} = require('./healthRecord.validation');

router.use(rateLimiter);
router.use(protect);

router.route('/prescription-medicines')
  .get(allow('view', 'view:limited', 'view:own'), ctrl.getPrescriptionMedicines);

router.route('/')
  .get(allow('view', 'view:limited', 'view:own', 'view:anonymized'), ctrl.getHealthRecords)
  .post(allow('update:medical', 'update:emr_ref'), validate(createHealthRecordSchema), ctrl.createHealthRecord);

router.get('/me', allow('view', 'view:limited', 'view:own'), ctrl.getMyHealthRecords);

router.route('/:id')
  .get(allow('view', 'view:limited', 'view:own', 'view:anonymized'), ctrl.getHealthRecordById)
  .patch(allow('update:medical', 'update:emr_ref'), validate(updateHealthRecordSchema), ctrl.updateHealthRecord)
  .delete(allow('soft_delete', 'update:medical'), ctrl.deleteHealthRecord);

module.exports = router;
