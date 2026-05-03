const express = require('express');
const router = express.Router();
const ctrl = require('./appointment.controller');
const { validate } = require('../../../middleware/validate.middleware');
const rateLimiter = require('../../../middleware/rateLimiter');
const {
  createAppointmentSchema,
  updateAppointmentSchema,
  cancelAppointmentSchema,
} = require('./appointment.validation');

router.use(rateLimiter);

router.route('/')
  .get(ctrl.getAppointments)
  .post(validate(createAppointmentSchema), ctrl.createAppointment);

router.patch('/:id', validate(updateAppointmentSchema), ctrl.updateAppointment);
router.patch('/:id/cancel', validate(cancelAppointmentSchema), ctrl.cancelAppointment);

module.exports = router;
