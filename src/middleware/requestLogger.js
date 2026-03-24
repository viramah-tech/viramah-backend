const AuditLog = require('../models/AuditLog');

const auditLog = (action, resource) => {
  return async (req, res, next) => {
    // Store original json method
    const originalJson = res.json.bind(res);

    res.json = function (body) {
      // Log after response
      if (req.user) {
        AuditLog.create({
          userId: req.user._id,
          userName: req.user.name,
          userRole: req.user.role,
          action,
          resource,
          resourceId: req.params.id || '',
          method: req.method,
          path: req.originalUrl,
          requestBody: sanitizeBody(req.body),
          statusCode: res.statusCode,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('User-Agent') || '',
          requestId: req.id,
        }).catch(err => console.error('Audit log error:', err.message));
      }
      return originalJson(body);
    };

    next();
  };
};

const sanitizeBody = (body) => {
  if (!body) return {};
  const sanitized = { ...body };
  const sensitiveFields = ['password', 'token', 'secret', 'authorization'];
  sensitiveFields.forEach(field => {
    if (sanitized[field]) sanitized[field] = '[REDACTED]';
  });
  return sanitized;
};

module.exports = { auditLog };
