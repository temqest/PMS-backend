const mongoose = require('mongoose');

const labTrendSchema = new mongoose.Schema(
  {
    patient_id: { type: String, required: true, index: true },
    test_name: { type: String, required: true },

    data_points: [
      {
        record_id: String,
        value: Number,
        raw_value_string: String,
        unit: String,
        status: { type: String, enum: ['Normal', 'Abnormal', 'Critical'], default: 'Normal' },
        recorded_at: Date,
      },
    ],

    trend_direction: {
      type: String,
      enum: ['Improving', 'Stable', 'Worsening', 'Insufficient data'],
      default: 'Insufficient data',
    },
    trend_severity: {
      type: String,
      enum: ['None', 'Mild', 'Moderate', 'Severe'],
      default: 'None',
    },
    consecutive_abnormal_count: { type: Number, default: 0 },
    last_value: { type: Number },
    last_status: { type: String },
    last_recorded_at: { type: Date },
    alert_triggered: { type: Boolean, default: false },
  },
  { timestamps: true }
);

labTrendSchema.index({ patient_id: 1, test_name: 1 }, { unique: true });

module.exports = mongoose.model('LabTrend', labTrendSchema);
