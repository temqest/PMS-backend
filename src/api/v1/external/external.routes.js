const express = require('express');
const router = express.Router();
const apiKeyAuth = require('../../../middleware/apiKey.middleware');
const prescriptionInvoiceCtrl = require('../prescription-invoices/prescriptionInvoice.controller');
const rateLimiter = require('../../../middleware/rateLimiter');

/**
 * External API routes for third-party access
 * These routes use API Key authentication instead of JWT
 * Usage: Add header "x-api-key: sk_live_xxxxx" to requests
 */

router.use(apiKeyAuth);
router.use(rateLimiter);

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
router.get('/invoices', prescriptionInvoiceCtrl.getPrescriptionInvoices);

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
router.get('/invoices/:id', prescriptionInvoiceCtrl.getPrescriptionInvoiceById);

module.exports = router;
