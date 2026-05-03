const express = require('express');
const router = express.Router();
const ctrl = require('./healthRecord.controller');
const { validate } = require('../../../middleware/validate.middleware');
const rateLimiter = require('../../../middleware/rateLimiter');
const {
  createHealthRecordSchema,
  updateHealthRecordSchema,
} = require('./healthRecord.validation');

router.use(rateLimiter);

router.route('/prescription-medicines')
  .get(ctrl.getPrescriptionMedicines);

router.route('/')
  .get(ctrl.getHealthRecords)
  .post(validate(createHealthRecordSchema), ctrl.createHealthRecord);

router.route('/:id')
  .get(ctrl.getHealthRecordById)
  .patch(validate(updateHealthRecordSchema), ctrl.updateHealthRecord)
  .delete(ctrl.deleteHealthRecord);

module.exports = router;
