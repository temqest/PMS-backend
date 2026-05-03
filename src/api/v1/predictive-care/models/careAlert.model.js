const mongoose = require('mongoose');

const careAlertSchema = new mongoose.Schema(
  {
    patient_id: { type: String, required: true, index: true },
    patient_name: { type: String },

    alert_type: {
      type: String,
      required: true,
      enum: [
        'LAB_TREND',
        'CHRONIC_RISK',
        'VACCINATION_GAP',
        'ADHERENCE_GAP',
        'NO_SHOW_RISK',
        'READMISSION_RISK',
        'CRITICAL_LAB',
      ],
    },

    severity: {
      type: String,
      enum: ['Info', 'Warning', 'Critical'],
      default: 'Info',
    },

    title: { type: String, required: true },
    message: { type: String, required: true },

    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    is_read: { type: Boolean, default: false },
    is_resolved: { type: Boolean, default: false },
    resolved_at: { type: Date },
    resolved_by: { type: String },

    triggered_at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

careAlertSchema.index({ patient_id: 1, alert_type: 1, triggered_at: -1 });

module.exports = mongoose.model('CareAlert', careAlertSchema);
