const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    user_id: { type: String, trim: true, default: null },
    action_type: { type: String, required: true, trim: true, uppercase: true },
    details: { type: String, trim: true, default: '' },
    ip_addr: { type: String, trim: true, default: '' },
    subsystem: { type: String, required: true, trim: true },
    created_at: { type: Date, default: Date.now, immutable: true },
  },
  {
    versionKey: false,
    collection: 'audit_logs',
  }
);

auditLogSchema.index({ created_at: -1 });
auditLogSchema.index({ action_type: 1, created_at: -1 });
auditLogSchema.index({ user_id: 1, created_at: -1 });
auditLogSchema.index({ subsystem: 1, created_at: -1 });
auditLogSchema.index({
  user_id: 'text',
  action_type: 'text',
  details: 'text',
  ip_addr: 'text',
  subsystem: 'text',
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
