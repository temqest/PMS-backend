const mongoose = require('mongoose');

const adherenceRecordSchema = new mongoose.Schema(
  {
    patient_id: { type: String, required: true, index: true },
    medicine_name: { type: String, required: true },

    prescription_windows: [
      {
        record_id: String,
        start_date: Date,
        end_date: Date,
        quantity: Number,
        refills: Number,
      },
    ],

    coverage_gaps: [
      {
        gap_start: Date,
        gap_end: Date,
        gap_days: Number,
      },
    ],

    confirmed_fills: [
      {
        invoice_id: String,
        fill_date: Date,
        quantity: Number,
      },
    ],

    adherence_score: { type: Number, default: 100, min: 0, max: 100 },

    status: {
      type: String,
      enum: ['Adherent', 'Partial', 'Non-adherent'],
      default: 'Adherent',
    },
    longest_gap_days: { type: Number, default: 0 },
    last_assessed_at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

adherenceRecordSchema.index({ patient_id: 1, medicine_name: 1 }, { unique: true });

module.exports = mongoose.model('AdherenceRecord', adherenceRecordSchema);
