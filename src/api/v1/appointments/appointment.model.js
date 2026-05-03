const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema(
  {
    appointment_id: { type: String, required: true, unique: true, immutable: true },
    patient_id: { type: String, required: true, trim: true },
    patient_name: { type: String, required: true, trim: true },
    appointment_type: { type: String, enum: ['In-Person', 'Telehealth'], default: 'In-Person' },
    scheduled_at: { type: Date, required: true },
    duration_minutes: { type: Number, enum: [15, 30, 45, 60], default: 30 },
    reason: { type: String, trim: true, default: '' },
    priority: { type: String, enum: ['Routine', 'Urgent', 'Follow-up'], default: 'Routine' },
    status: { type: String, enum: ['Pending', 'Confirmed', 'Cancelled', 'Completed'], default: 'Pending' },
    send_email_reminder: { type: Boolean, default: false },
    send_sms_reminder: { type: Boolean, default: false },
    send_confirmation: { type: Boolean, default: true },
    internal_notes: { type: String, trim: true, default: '' },
    cancel_reason: { type: String, trim: true, default: '' },
    cancelled_at: { type: Date },
    created_by: { type: String },
    updated_by: { type: String },
    __v: { type: Number, select: false },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: '__v',
  }
);

appointmentSchema.index({ scheduled_at: 1 });
appointmentSchema.index({ status: 1 });
appointmentSchema.index({ patient_id: 1 });

module.exports = mongoose.model('Appointment', appointmentSchema);
