const ApiKey = require('../api/v1/api-keys/apiKey.model');
const AppError = require('../utils/AppError');

const apiKeyAuth = async (req, res, next) => {
  try {
    // Get API key from header
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
      return next(new AppError('API key is required in x-api-key header', 401));
    }

    // Hash the provided key
    const keyHash = require('crypto')
      .createHash('sha256')
      .update(apiKey)
      .digest('hex');

    // Find the API key in database
    const apiKeyDoc = await ApiKey.findOne({
      keyHash,
      status: 'active',
    }).select('+keyHash');

    if (!apiKeyDoc) {
      return next(new AppError('Invalid or revoked API key', 401));
    }

    // Update last_used_at
    apiKeyDoc.last_used_at = new Date();
    await apiKeyDoc.save();

    // Attach key info to request object
    req.apiKey = {
      id: apiKeyDoc._id,
      name: apiKeyDoc.name,
      permissions: apiKeyDoc.permissions,
      createdBy: apiKeyDoc.created_by,
    };

    next();
  } catch (err) {
    next(err);
  }
};

module.exports = apiKeyAuth;
