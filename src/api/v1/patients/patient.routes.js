const express = require('express');
const router = express.Router();
const ctrl = require('./patient.controller');
const { protect } = require('../../../middleware/auth.middleware');
const { allow } = require('../../../middleware/rbac.middleware');
const { validate } = require('../../../middleware/validate.middleware');
const rateLimiter = require('../../../middleware/rateLimiter');
const { createPatientSchema, updatePatientSchema } = require('./patient.validation');

router.use(protect);
router.use(rateLimiter);

router.route('/')
  .post(allow('register'), validate(createPatientSchema), ctrl.registerPatient)
  .get(allow('view', 'view:limited', 'view:anonymized', 'view:own'), ctrl.getPatients);

router.get('/me', allow('view', 'view:limited', 'view:anonymized', 'view:own'), ctrl.getCurrentPatient);
router.patch('/me', allow('update:own', 'update'), validate(updatePatientSchema), ctrl.updateCurrentPatient);

router.route('/:id')
  .get(allow('view', 'view:limited', 'view:anonymized', 'view:own'), ctrl.getPatientById)
  .patch(allow('update', 'update:medical'), validate(updatePatientSchema), ctrl.updatePatient)
  .delete(allow('soft_delete'), ctrl.softDeletePatient);

router.patch('/:id/appointments', allow('update:appointment_ref'), ctrl.linkAppointment);
router.patch('/:id/medical-history', allow('update:emr_ref'), ctrl.updateMedicalHistory);

module.exports = router;
