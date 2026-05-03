const mongoose = require('mongoose');

const healthRecordSchema = new mongoose.Schema(
  {
    record_id: { type: String, required: true, unique: true, immutable: true },
    patient_id: { type: String, required: true, trim: true },
    patient_name: { type: String, required: true, trim: true },
    record_type: {
      type: String,
      enum: ['Visit', 'Lab Result', 'Imaging', 'Prescription', 'Vaccination', 'Note'],
      required: true,
    },
    record_date: { type: Date, required: true },
    provider: { type: String, required: true, trim: true },
    save_state: { type: String, enum: ['draft', 'final'], default: 'final' },
    summary: { type: String, trim: true, default: '' },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    archived: { type: Boolean, default: false },
    archived_at: { type: Date },
    created_by: { type: String },
    updated_by: { type: String },
    __v: { type: Number, select: false },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: '__v',
  }
);

healthRecordSchema.index({ patient_id: 1, record_date: -1 });
healthRecordSchema.index({ record_type: 1, record_date: -1 });
healthRecordSchema.index({ archived: 1 });

module.exports = mongoose.model('HealthRecord', healthRecordSchema);
