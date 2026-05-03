const ApiKey = require('./apiKey.model');
const AppError = require('../../../utils/AppError');
const asyncHandler = require('../../../utils/asyncHandler');
const apiResponse = require('../../../utils/apiResponse');

/**
 * Create a new API key
 * POST /api/v1/api-keys
 */
exports.createApiKey = asyncHandler(async (req, res, next) => {
  const { name, description, permissions } = req.body;

  // Generate new API key
  const newApiKey = ApiKey.generateApiKey();
  const keyHash = ApiKey.hashApiKey(newApiKey);
  const prefix = newApiKey.substring(0, 14); // "sk_live_abc123"

  const apiKeyDoc = await ApiKey.create({
    name,
    keyHash,
    prefix,
    description: description || '',
    permissions: permissions || ['read:invoices'],
    created_by: req.user.sub,
  });

  // Return the full key only once (user must save it securely)
  apiResponse.success(res, 201, {
    id: apiKeyDoc._id,
    name: apiKeyDoc.name,
    prefix: apiKeyDoc.prefix,
    apiKey: newApiKey, // Return full key only on creation
    permissions: apiKeyDoc.permissions,
    description: apiKeyDoc.description,
  }, { message: 'API key created successfully. Save this key securely - you will not see it again.' });
});

/**
 * Get all API keys for current user
 * GET /api/v1/api-keys
 */
exports.getApiKeys = asyncHandler(async (req, res, next) => {
  const apiKeys = await ApiKey.find({ created_by: req.user.sub }).select('-keyHash');

  apiResponse.success(res, 200, apiKeys, { count: apiKeys.length });
});

/**
 * Get a specific API key by ID
 * GET /api/v1/api-keys/:id
 */
exports.getApiKeyById = asyncHandler(async (req, res, next) => {
  const apiKey = await ApiKey.findById(req.params.id).select('-keyHash');

  if (!apiKey) {
    return next(new AppError('API key not found', 404));
  }

  // Check authorization
  if (apiKey.created_by !== req.user.sub && req.user.role !== 'system_admin') {
    return next(new AppError('Not authorized to view this API key', 403));
  }

  apiResponse.success(res, 200, apiKey);
});

/**
 * Revoke an API key
 * PATCH /api/v1/api-keys/:id/revoke
 */
exports.revokeApiKey = asyncHandler(async (req, res, next) => {
  const apiKey = await ApiKey.findById(req.params.id);

  if (!apiKey) {
    return next(new AppError('API key not found', 404));
  }

  // Check authorization
  if (apiKey.created_by !== req.user.sub && req.user.role !== 'system_admin') {
    return next(new AppError('Not authorized to revoke this API key', 403));
  }

  apiKey.status = 'revoked';
  apiKey.revoked_at = new Date();
  apiKey.revoked_by = req.user.sub;
  await apiKey.save();

  apiResponse.success(res, 200, {
    id: apiKey._id,
    status: apiKey.status,
    revoked_at: apiKey.revoked_at,
  }, { message: 'API key revoked successfully' });
});

/**
 * Delete an API key
 * DELETE /api/v1/api-keys/:id
 */
exports.deleteApiKey = asyncHandler(async (req, res, next) => {
  const apiKey = await ApiKey.findByIdAndDelete(req.params.id);

  if (!apiKey) {
    return next(new AppError('API key not found', 404));
  }

  // Check authorization
  if (apiKey.created_by !== req.user.sub && req.user.role !== 'system_admin') {
    return next(new AppError('Not authorized to delete this API key', 403));
  }

  apiResponse.success(res, 200, {}, { message: 'API key deleted successfully' });
});

/**
 * Rotate (regenerate) an existing API key secret
 * PATCH /api/v1/api-keys/:id/rotate
 *
 * Returns the full new key ONE time only.
 */
exports.rotateApiKey = asyncHandler(async (req, res, next) => {
  const apiKeyDoc = await ApiKey.findById(req.params.id).select('+keyHash');

  if (!apiKeyDoc) {
    return next(new AppError('API key not found', 404));
  }

  // Check authorization
  if (apiKeyDoc.created_by !== req.user.sub && req.user.role !== 'system_admin') {
    return next(new AppError('Not authorized to rotate this API key', 403));
  }

  // Generate a new unique key (retry on rare hash collision)
  let newApiKey = '';
  let keyHash = '';
  let prefix = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    newApiKey = ApiKey.generateApiKey();
    keyHash = ApiKey.hashApiKey(newApiKey);
    prefix = newApiKey.substring(0, 14);
    // eslint-disable-next-line no-await-in-loop
    const exists = await ApiKey.findOne({ keyHash }).select('_id');
    if (!exists) break;
    if (attempt === 4) {
      return next(new AppError('Failed to rotate API key. Please try again.', 500));
    }
  }

  apiKeyDoc.keyHash = keyHash;
  apiKeyDoc.prefix = prefix;
  apiKeyDoc.status = 'active';
  apiKeyDoc.revoked_at = null;
  apiKeyDoc.revoked_by = null;

  // Optional metadata updates during rotation (so you can rotate + change permissions in one call)
  const { name, description, permissions } = req.body || {};
  if (typeof name !== 'undefined') apiKeyDoc.name = name;
  if (typeof description !== 'undefined') apiKeyDoc.description = description;
  if (typeof permissions !== 'undefined') {
    const unique = Array.from(new Set((Array.isArray(permissions) ? permissions : []).filter(Boolean)));
    apiKeyDoc.permissions = unique;
  }

  await apiKeyDoc.save();

  apiResponse.success(
    res,
    200,
    {
      id: apiKeyDoc._id,
      name: apiKeyDoc.name,
      prefix: apiKeyDoc.prefix,
      apiKey: newApiKey,
      permissions: apiKeyDoc.permissions,
      description: apiKeyDoc.description,
      status: apiKeyDoc.status,
      updated_at: apiKeyDoc.updated_at,
    },
    { message: 'API key rotated successfully. Save this key securely - you will not see it again.' }
  );
});

/**
 * Update API key metadata (name/description/permissions)
 * PATCH /api/v1/api-keys/:id
 */
exports.updateApiKey = asyncHandler(async (req, res, next) => {
  const apiKeyDoc = await ApiKey.findById(req.params.id).select('-keyHash');

  if (!apiKeyDoc) {
    return next(new AppError('API key not found', 404));
  }

  // Check authorization
  if (apiKeyDoc.created_by !== req.user.sub && req.user.role !== 'system_admin') {
    return next(new AppError('Not authorized to update this API key', 403));
  }

  const { name, description, permissions } = req.body || {};

  if (typeof name !== 'undefined') apiKeyDoc.name = name;
  if (typeof description !== 'undefined') apiKeyDoc.description = description;
  if (typeof permissions !== 'undefined') {
    const unique = Array.from(new Set((Array.isArray(permissions) ? permissions : []).filter(Boolean)));
    apiKeyDoc.permissions = unique;
  }

  await apiKeyDoc.save();

  apiResponse.success(res, 200, apiKeyDoc, { message: 'API key updated successfully' });
});
