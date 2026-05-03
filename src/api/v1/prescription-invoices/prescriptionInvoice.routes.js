const express = require('express');
const router = express.Router();
const ctrl = require('./prescriptionInvoice.controller');
const { protect } = require('../../../middleware/auth.middleware');
const { allow } = require('../../../middleware/rbac.middleware');
const { validate } = require('../../../middleware/validate.middleware');
const rateLimiter = require('../../../middleware/rateLimiter');
const { createPrescriptionInvoiceSchema } = require('./prescriptionInvoice.validation');

router.use(protect);
router.use(rateLimiter);

router.route('/')
  .get(allow('view', 'view:limited', 'view:anonymized', 'view:own'), ctrl.getPrescriptionInvoices)
  .post(allow('create', 'register'), validate(createPrescriptionInvoiceSchema), ctrl.createPrescriptionInvoice);

router.route('/:id')
  .get(allow('view', 'view:limited', 'view:anonymized', 'view:own'), ctrl.getPrescriptionInvoiceById);

module.exports = router;
