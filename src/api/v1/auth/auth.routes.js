const express = require('express');
const router = express.Router();
const ctrl = require('./auth.controller');
const { allow } = require('../../../middleware/rbac.middleware');
const { protect } = require('../../../middleware/auth.middleware');

router.post('/login', ctrl.login);
router.post('/logout', protect, ctrl.logout);
router.post('/register', ctrl.register);
router.get('/me', protect, ctrl.getMe);

// Admin-only routes for account activation
router.get('/users/pending', protect, allow('register'), ctrl.getPendingUsers);
router.get('/users', protect, allow('register'), ctrl.getAllUsers);
router.post('/users/:userId/activate', protect, allow('register'), ctrl.activateUser);
router.post('/users/:userId/deactivate', protect, allow('register'), ctrl.deactivateUser);

module.exports = router;
