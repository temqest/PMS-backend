const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password_hash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      required: true,
      enum: [
        'system_admin',
        'front_desk',
        'physician',
        'billing_system',
        'appointment_system',
        'emr_system',
        'predictive_analytics',
        'patient',
      ],
      default: 'patient',
    },
    patient_id: {
      type: String,
      default: null,
      trim: true,
    },
    fullName: {
      type: String,
      trim: true,
      default: '',
    },
    is_active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

userSchema.index({ role: 1, is_active: 1 });
userSchema.index({ patient_id: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('User', userSchema);
