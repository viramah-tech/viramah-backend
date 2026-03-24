const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userName: { type: String, default: '' },
  userRole: { type: String, default: '' },
  action: { type: String, required: true },
  resource: { type: String, required: true },
  resourceId: { type: String, default: '' },
  method: { type: String, required: true },
  path: { type: String, required: true },
  requestBody: { type: mongoose.Schema.Types.Mixed, default: {} },
  statusCode: { type: Number },
  ipAddress: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  requestId: { type: String, default: '' },
}, {
  timestamps: true,
});

// Index for querying (TTL: auto-delete after 90 days)
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ resource: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
