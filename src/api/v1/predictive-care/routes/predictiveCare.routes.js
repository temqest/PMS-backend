const express = require('express');
const { validate, validatePart } = require('../../../../middleware/validate.middleware');
const { protect } = require('../../../../middleware/auth.middleware');
const { allow } = require('../../../../middleware/rbac.middleware');
const rateLimiter = require('../../../../middleware/rateLimiter');
const riskProfile = require('../controllers/riskProfile.controller');
const alerts = require('../controllers/alerts.controller');
const analytics = require('../controllers/analytics.controller');
const {
  patientIdParamSchema,
  riskProfileListQuerySchema,
  alertsListQuerySchema,
  retrainBodySchema,
  labForecastQuerySchema,
  mongoIdParamSchema,
  resolveAlertBodySchema,
} = require('../predictiveCare.validation');

const router = express.Router();

const readAccess = ['view', 'analytics', 'view:limited', 'view:anonymized', 'view:own'];
const writeAccess = ['update', 'update:medical', 'analytics'];

router.use(protect);
router.use(rateLimiter);

// ----- Risk Profiles (compute-all BEFORE :patientId) -----
router.post(
  '/profiles/compute-all',
  allow('analytics', 'update:medical'),
  riskProfile.computeForAll
);

router.get(
  '/profiles',
  allow(...readAccess),
  validatePart(riskProfileListQuerySchema, 'query'),
  riskProfile.getAllRiskProfiles
);

router.get(
  '/profiles/:patientId',
  allow(...readAccess),
  validatePart(patientIdParamSchema, 'params'),
  riskProfile.getPatientRiskProfile
);

router.post(
  '/profiles/:patientId/compute',
  allow(...writeAccess),
  validatePart(patientIdParamSchema, 'params'),
  riskProfile.computeForPatient
);

router.post(
  '/ml/retrain',
  allow(...writeAccess),
  validate(retrainBodySchema),
  riskProfile.retrainModels
);

// ----- Alerts -----
router.get(
  '/alerts',
  allow(...readAccess),
  validatePart(alertsListQuerySchema, 'query'),
  alerts.getAlerts
);

router.patch(
  '/alerts/:id/resolve',
  allow(...writeAccess),
  validatePart(mongoIdParamSchema, 'params'),
  validate(resolveAlertBodySchema),
  alerts.resolveAlert
);

router.patch(
  '/alerts/:id/read',
  allow(...writeAccess),
  validatePart(mongoIdParamSchema, 'params'),
  alerts.markAlertRead
);

// ----- Analytics -----
router.get('/analytics/dashboard', allow(...readAccess), analytics.dashboardSummary);

router.get(
  '/analytics/:patientId/lab-trends',
  allow(...readAccess),
  validatePart(patientIdParamSchema, 'params'),
  analytics.labTrendChart
);

router.get(
  '/analytics/:patientId/lab-forecast',
  allow(...readAccess),
  validatePart(patientIdParamSchema, 'params'),
  validatePart(labForecastQuerySchema, 'query'),
  riskProfile.labForecast
);

router.get(
  '/analytics/:patientId/risk-radar',
  allow(...readAccess),
  validatePart(patientIdParamSchema, 'params'),
  analytics.riskRadar
);

router.get(
  '/analytics/:patientId/adherence',
  allow(...readAccess),
  validatePart(patientIdParamSchema, 'params'),
  analytics.adherenceChart
);

router.get(
  '/analytics/:patientId/alert-timeline',
  allow(...readAccess),
  validatePart(patientIdParamSchema, 'params'),
  analytics.alertTimeline
);

module.exports = router;
