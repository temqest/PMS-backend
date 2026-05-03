const mongoose = require('mongoose');
const crypto = require('crypto');

const apiKeySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      description: 'Friendly name for this API key (e.g., "Partner Project X")',
    },
    keyHash: {
      type: String,
      required: true,
      unique: true,
      select: false, // Don't return this by default
      description: 'SHA-256 hash of the actual API key',
    },
    prefix: {
      type: String,
      required: true,
      description: 'First 8 characters of the key for reference (e.g., "sk_live_abc123")',
    },
    description: {
      type: String,
      trim: true,
      description: 'What this API key is used for',
    },
    status: {
      type: String,
      enum: ['active', 'revoked'],
      default: 'active',
    },
    permissions: {
      type: [String],
      default: ['read:invoices'],
      description: 'What this API key can access',
    },
    last_used_at: {
      type: Date,
      default: null,
    },
    created_by: {
      type: String,
      required: true,
      description: 'User ID who created this key',
    },
    revoked_at: {
      type: Date,
      default: null,
    },
    revoked_by: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// Index for faster lookups
apiKeySchema.index({ status: 1 });
apiKeySchema.index({ created_by: 1 });

// Static method to hash the API key
apiKeySchema.statics.hashApiKey = function (apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
};

// Static method to generate a new API key
apiKeySchema.statics.generateApiKey = function () {
  // Format: sk_live_[random base64 string]
  const randomBytes = crypto.randomBytes(32).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
  return `sk_live_${randomBytes}`;
};

module.exports = mongoose.model('ApiKey', apiKeySchema);
