const express = require('express');
const router = express.Router();
const ctrl = require('./apiKey.controller');
const { protect } = require('../../../middleware/auth.middleware');
const { validate } = require('../../../middleware/validate.middleware');
const { createApiKeySchema } = require('./apiKey.validation');

// All API key management routes require authentication
router.use(protect);

router.route('/')
  .get(ctrl.getApiKeys)
  .post(validate(createApiKeySchema), ctrl.createApiKey);

router.route('/:id')
  .get(ctrl.getApiKeyById)
  .delete(ctrl.deleteApiKey);

router.patch('/:id/revoke', ctrl.revokeApiKey);

module.exports = router;
