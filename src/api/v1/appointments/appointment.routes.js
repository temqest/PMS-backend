const express = require('express');
const router = express.Router();
const ctrl = require('./appointment.controller');
const { validate } = require('../../../middleware/validate.middleware');
const { protect } = require('../../../middleware/auth.middleware');
const { allow } = require('../../../middleware/rbac.middleware');
const rateLimiter = require('../../../middleware/rateLimiter');
const {
  createAppointmentSchema,
  updateAppointmentSchema,
  cancelAppointmentSchema,
} = require('./appointment.validation');

router.use(rateLimiter);
router.use(protect);

router.route('/')
  .get(allow('view', 'view:limited', 'view:own'), ctrl.getAppointments)
  .post(allow('create:own', 'register', 'create'), validate(createAppointmentSchema), ctrl.createAppointment);

router.get('/me', allow('view', 'view:limited', 'view:own'), ctrl.getMyAppointments);

router.patch('/:id', allow('update:own', 'update', 'update:appointment_ref'), validate(updateAppointmentSchema), ctrl.updateAppointment);
router.patch('/:id/cancel', allow('update:own', 'update', 'update:appointment_ref'), validate(cancelAppointmentSchema), ctrl.cancelAppointment);

module.exports = router;
