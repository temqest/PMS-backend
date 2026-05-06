const mongoose = require('mongoose');

const patientRiskProfileSchema = new mongoose.Schema(
  {
    patient_id: { type: String, required: true, unique: true, index: true },
    patient_name: { type: String },

    overall_risk_level: {
      type: String,
      enum: ['Low', 'Moderate', 'High', 'Critical'],
      default: 'Low',
    },
    overall_risk_score: { type: Number, default: 0, min: 0, max: 100 },

    chronic_disease_risk: { type: Number, default: 0 },
    readmission_risk: { type: Number, default: 0 },
    no_show_risk: { type: Number, default: 0 },
    adherence_risk: { type: Number, default: 0 },

    has_critical_labs: { type: Boolean, default: false },
    has_overdue_vaccinations: { type: Boolean, default: false },
    has_adherence_gaps: { type: Boolean, default: false },

    ml_readmission_prob: { type: Number },
    ml_readmission_level: { type: String },
    ml_chronic_level: { type: String },
    ml_chronic_confidence: { type: Number },
    ml_top_risk_factors: [
      {
        feature: { type: String },
        importance: { type: Number },
      },
    ],
    ml_is_anomaly: { type: Boolean },
    ml_anomaly_score: { type: Number },
    ml_computed_at: { type: Date },
    ml_service_used: { type: Boolean, default: false },
    ml_feature_version: { type: String },
    ml_label_definition: { type: String },
    ml_last_feature_snapshot: { type: mongoose.Schema.Types.Mixed },
    ml_explanation: [
      {
        feature: { type: String },
        importance: { type: Number },
        resolved_value: { type: mongoose.Schema.Types.Mixed },
      },
    ],

    last_computed_at: { type: Date, default: Date.now },
    record_count_at_last_compute: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PatientRiskProfile', patientRiskProfileSchema);
