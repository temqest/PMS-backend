const mongoose = require('mongoose');

const patientSchema = new mongoose.Schema(
  {
    patient_id: {
      type: String,
      unique: true,
      required: true,
      immutable: true,
    },
    first_name:    { type: String, required: true, trim: true },
    last_name:     { type: String, required: true, trim: true },
    date_of_birth: { type: Date,   required: true },
    gender:        { type: String, required: true, enum: ['Male', 'Female', 'Other'] },
    contact_number:{ type: String, required: true, trim: true },
    email_address: { type: String, trim: true, lowercase: true },
    address:       { type: String, required: true },
    national_id:   { type: String, trim: true },

    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
    },

    visit_count:          { type: Number, default: 0 },
    last_visit_date:      { type: Date },
    attending_physician:  { type: String },

    medical_history_ref:  { type: String },
    appointment_refs:     [{ type: String }],
    billing_refs:         [{ type: String }],
    // Insurance information: provider and coverage percentage (0-100)
    insurance: {
      provider: { type: String, trim: true, default: '' },
      coverage_percentage: { type: Number, min: 0, max: 100, default: 0 },
      policy_number: { type: String, trim: true, default: '' },
      group_number: { type: String, trim: true, default: '' },
    },
    lifestyle: {
      smoking: { type: Boolean, default: false },
      alcohol: { type: Boolean, default: false },
      diet: { type: String, trim: true, default: '' },
      physical_activity: { type: String, trim: true, default: '' },
    },

    created_by:  { type: String, required: true },
    updated_by:  { type: String },

    __v: { type: Number, select: false },
  },
  {
    timestamps: { createdAt: 'registration_date', updatedAt: 'updated_at' },
    versionKey: '__v',
  }
);

patientSchema.index({ contact_number: 1 });
patientSchema.index({ national_id: 1 }, { sparse: true });
patientSchema.index({ status: 1 });

module.exports = mongoose.model('Patient', patientSchema);
