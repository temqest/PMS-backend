const mongoose = require('mongoose');

const invoiceItemSchema = new mongoose.Schema(
  {
    medicineId: { type: String, required: true, trim: true },
    medicineName: { type: String, required: true, trim: true },
    prescribedDosage: { type: String, required: true, trim: true },
    prescribedQuantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const prescriptionInvoiceSchema = new mongoose.Schema(
  {
    invoice_id: { type: String, required: true, unique: true, immutable: true },
    patient_id: { type: String, required: true, trim: true },
    patient_name: { type: String, required: true, trim: true },
    health_record_id: { type: String, trim: true, default: '' },
    items: { type: [invoiceItemSchema], required: true, default: [] },
    prescription_names: { type: [String], default: [] },
    // arbitrary variable field (can store small metadata) and release flag
    variable: { type: mongoose.Schema.Types.Mixed, default: null },
    is_released: { type: Boolean, default: false },
    total_amount: { type: Number, required: true, min: 0 },
    invoice_date: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'paid', 'cancelled'], default: 'pending' },
    created_by: { type: String },
    updated_by: { type: String },
    __v: { type: Number, select: false },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: '__v',
  }
);

prescriptionInvoiceSchema.index({ patient_id: 1, invoice_date: -1 });
prescriptionInvoiceSchema.index({ health_record_id: 1 });
prescriptionInvoiceSchema.index({ invoice_id: 1 });

module.exports = mongoose.model('PrescriptionInvoice', prescriptionInvoiceSchema);
