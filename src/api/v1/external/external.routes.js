const express = require('express');
const router = express.Router();
const apiKeyAuth = require('../../../middleware/apiKey.middleware');
const asyncHandler = require('../../../utils/asyncHandler');
const AppError = require('../../../utils/AppError');
const apiResponse = require('../../../utils/apiResponse');
const { ROLES } = require('../../../config/constants');
const prescriptionInvoiceCtrl = require('../prescription-invoices/prescriptionInvoice.controller');
const { validate } = require('../../../middleware/validate.middleware');
const { updatePrescriptionInvoiceStatusSchema } = require('../prescription-invoices/prescriptionInvoice.validation');
const patientService = require('../patients/patient.service');
const healthRecordService = require('../health-records/healthRecord.service');
const rateLimiter = require('../../../middleware/rateLimiter');

/**
 * External API routes for third-party access
 * These routes use API Key authentication instead of JWT
 * Usage: Add header "x-api-key: sk_live_xxxxx" to requests
 */

router.use(apiKeyAuth);
router.use(rateLimiter);

const requirePermission = (...required) => (req, res, next) => {
	const granted = req.apiKey?.permissions || [];
	if (required.some((p) => granted.includes(p))) {
		return next();
	}
	return next(new AppError('API key does not have permission for this route', 403));
};

/**
 * GET /api/v1/external/invoices
 * Get all prescription invoices (API key authenticated)
 * 
 * Headers:
 *   x-api-key: sk_live_xxxxx (required)
 * 
 * Query Parameters:
 *   - page: number (optional, default: 1)
 *   - limit: number (optional, default: 10)
 *   - status: string (optional, filter by status)
 * 
 * Response:
 *   {
 *     success: true,
 *     data: [...invoices],
 *     count: number,
 *     pagination: { page, limit, total }
 *   }
 */
router.get('/invoices', requirePermission('read:invoices'), prescriptionInvoiceCtrl.getPrescriptionInvoices);

/**
 * GET /api/v1/external/invoices/:id
 * Get a specific prescription invoice by ID (API key authenticated)
 * 
 * Headers:
 *   x-api-key: sk_live_xxxxx (required)
 * 
 * Response:
 *   {
 *     success: true,
 *     data: { invoice details }
 *   }
 */
router.get('/invoices/:id', requirePermission('read:invoices'), prescriptionInvoiceCtrl.getPrescriptionInvoiceById);

/**
 * PATCH /api/v1/external/invoices/:id
 * Update only the status of a prescription invoice (API key authenticated)
 */
router.patch(
	'/invoices/:id',
	requirePermission('write:invoices'),
	validate(updatePrescriptionInvoiceStatusSchema),
	prescriptionInvoiceCtrl.updatePrescriptionInvoiceStatus
);

/**
 * GET /api/v1/external/patients
 * Get all patients (API key authenticated)
 */
router.get(
	'/patients',
	requirePermission('read:patients'),
	asyncHandler(async (req, res) => {
		const actor = { id: req.apiKey?.createdBy, role: ROLES.SYSTEM_ADMIN };
		const result = await patientService.getPatients(req.query, actor);
		apiResponse.success(
			res,
			200,
			{ patients: result.patients },
			{ results: result.results, pagination: result.pagination }
		);
	})
);

/**
 * GET /api/v1/external/patients/:id
 * Get one patient by patient_id (API key authenticated)
 */
router.get(
	'/patients/:id',
	requirePermission('read:patients'),
	asyncHandler(async (req, res) => {
		const actor = { id: req.apiKey?.createdBy, role: ROLES.SYSTEM_ADMIN };
		const patient = await patientService.getPatientById(req.params.id, actor);
		apiResponse.success(res, 200, { patient });
	})
);

/**
 * GET /api/v1/external/health-records
 * Get all health records (API key authenticated)
 */
router.get(
	'/health-records',
	requirePermission('read:health-records'),
	asyncHandler(async (req, res) => {
		const result = await healthRecordService.getHealthRecords(req.query);
		apiResponse.success(
			res,
			200,
			{ records: result.records },
			{ results: result.results, pagination: result.pagination }
		);
	})
);

/**
 * GET /api/v1/external/health-records/:id
 * Get one health record by record_id (API key authenticated)
 */
router.get(
	'/health-records/:id',
	requirePermission('read:health-records'),
	asyncHandler(async (req, res) => {
		const record = await healthRecordService.getHealthRecordById(req.params.id);
		apiResponse.success(res, 200, { record });
	})
);

module.exports = router;
