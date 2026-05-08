const AuditLog = require('./auditLog.model');
const logger = require('../../../utils/logger');
const axios = require('axios');

const MAX_STRING_LENGTH = 1000;
const MAX_DETAILS_LENGTH = 2000;
const MAX_ARRAY_LENGTH = 25;
const MAX_OBJECT_KEYS = 80;
const MAX_DEPTH = 4;

const SENSITIVE_KEY_PATTERN = /(password|passcode|token|secret|authorization|cookie|apikey|api_key|keyhash|bearer|jwt|credential)/i;

const SUBSYSTEM_LABELS = {
  api_key: 'API Key',
  appointment: 'Appointment',
  auth: 'Auth',
  health_record: 'Health Record',
  patient: 'Patient',
  prescription: 'Prescription',
  prescription_invoice: 'Prescription Invoice',
  user: 'User',
};

const DEFAULT_AUDIT_LOG_PATH = '/admin/api/audit-logs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeBaseUrl = (value = '') => String(value || '').trim().replace(/\/+$/, '');

const getExternalAuditUrl = () => {
  const explicitUrl = String(process.env.AUDIT_LOG_API_URL || '').trim();
  if (explicitUrl) return explicitUrl;

  const adminBaseUrl = normalizeBaseUrl(process.env.ADMIN_SYSTEM_URL);
  if (!adminBaseUrl) return '';

  const auditPath = String(process.env.AUDIT_LOG_API_PATH || DEFAULT_AUDIT_LOG_PATH).trim();
  return `${adminBaseUrl}${auditPath.startsWith('/') ? auditPath : `/${auditPath}`}`;
};

const getRetryCount = () => {
  const configured = Number.parseInt(process.env.AUDIT_LOG_RETRY_COUNT, 10);
  if (Number.isNaN(configured)) return 1;
  return Math.min(3, Math.max(0, configured));
};

const getTimeoutMs = () => {
  const configured = Number.parseInt(process.env.AUDIT_LOG_TIMEOUT_MS, 10);
  if (Number.isNaN(configured)) return 3000;
  return Math.min(15000, Math.max(500, configured));
};

const toPlainObject = (value) => {
  if (!value) return value;
  if (typeof value.toObject === 'function') {
    return value.toObject({ depopulate: true, versionKey: false });
  }
  if (typeof value.toJSON === 'function') {
    return value.toJSON();
  }
  return value;
};

const normalizePrimitive = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`
      : value;
  }
  return value;
};

const sanitizeAuditValue = (value, depth = 0) => {
  if (value === null || typeof value === 'undefined') return value ?? null;

  const plain = toPlainObject(value);
  if (plain === null || typeof plain !== 'object') return normalizePrimitive(plain);
  if (depth >= MAX_DEPTH) return '[truncated_depth]';

  if (Array.isArray(plain)) {
    const items = plain.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeAuditValue(item, depth + 1));
    if (plain.length > MAX_ARRAY_LENGTH) {
      items.push(`[${plain.length - MAX_ARRAY_LENGTH} more items truncated]`);
    }
    return items;
  }

  const sanitized = {};
  const entries = Object.entries(plain).filter(([key]) => key !== '__v');
  entries.slice(0, MAX_OBJECT_KEYS).forEach(([key, item]) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      sanitized[key] = '[redacted]';
      return;
    }
    sanitized[key] = sanitizeAuditValue(item, depth + 1);
  });

  if (entries.length > MAX_OBJECT_KEYS) {
    sanitized.__truncated_keys = entries.length - MAX_OBJECT_KEYS;
  }
  return sanitized;
};

const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const diffValues = (oldValue, newValue) => {
  const oldClean = sanitizeAuditValue(oldValue);
  const newClean = sanitizeAuditValue(newValue);
  const oldObj = oldClean && typeof oldClean === 'object' && !Array.isArray(oldClean) ? oldClean : {};
  const newObj = newClean && typeof newClean === 'object' && !Array.isArray(newClean) ? newClean : {};
  const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  const oldDiff = {};
  const newDiff = {};

  keys.forEach((key) => {
    if (stableStringify(oldObj[key]) !== stableStringify(newObj[key])) {
      oldDiff[key] = typeof oldObj[key] === 'undefined' ? null : oldObj[key];
      newDiff[key] = typeof newObj[key] === 'undefined' ? null : newObj[key];
    }
  });

  return { old_value: oldDiff, new_value: newDiff };
};

const truncateDetails = (value = '') => {
  const text = String(value || '').trim();
  return text.length > MAX_DETAILS_LENGTH ? `${text.slice(0, MAX_DETAILS_LENGTH)}...[truncated]` : text;
};

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const subsystemFromPayload = (payload = {}) => {
  if (payload.subsystem) return String(payload.subsystem).trim();
  const entityType = String(payload.entity_type || '').trim();
  return SUBSYSTEM_LABELS[entityType] || entityType || 'System';
};

const actionTypeFromPayload = (payload = {}) =>
  String(payload.action_type || payload.action || '').trim().toUpperCase();

const detailsFromPayload = (payload = {}) => {
  const base = payload.details || payload.description || '';
  const parts = [base];
  const entityBits = [];
  if (payload.entity_type) entityBits.push(`subsystem=${payload.entity_type}`);
  if (payload.entity_id) entityBits.push(`entity_id=${payload.entity_id}`);
  if (payload.entity_name) entityBits.push(`entity=${payload.entity_name}`);
  if (entityBits.length) parts.push(`(${entityBits.join(', ')})`);

  if (payload.old_value || payload.new_value) {
    const changes = {};
    if (payload.old_value) changes.old_value = sanitizeAuditValue(payload.old_value);
    if (payload.new_value) changes.new_value = sanitizeAuditValue(payload.new_value);
    parts.push(`changes=${JSON.stringify(changes)}`);
  }

  return truncateDetails(parts.filter(Boolean).join(' '));
};

const buildActorFromRequest = (req = {}) => ({
  id: req.user?.sub || req.apiKey?.createdBy || null,
  name: req.user?.fullName || req.apiKey?.name || '',
  role: req.user?.role || (req.apiKey ? 'api_key' : ''),
  patient_id: req.user?.patient_id || null,
  ip: req.ip || req.headers?.['x-forwarded-for'] || '',
  user_agent: req.get ? req.get('user-agent') || '' : req.headers?.['user-agent'] || '',
});

const buildAuditPayload = (payload = {}) => {
  const actor = payload.actor || {};
  const actionType = actionTypeFromPayload(payload);
  const subsystem = subsystemFromPayload(payload);

  return {
    user_id: payload.user_id ?? payload.actor_user_id ?? actor.id ?? null,
    action_type: actionType,
    details: detailsFromPayload(payload),
    ip_addr: payload.ip_addr ?? payload.ip_address ?? actor.ip ?? '',
    subsystem,
  };
};

const sendAuditLog = async (auditPayload = {}) => {
  const url = getExternalAuditUrl();
  const subsystemKey = String(process.env.SUBSYSTEM_API_KEY || '').trim();

  if (!url) return { sent: false, skipped: true, reason: 'missing_audit_log_url' };
  if (!subsystemKey) {
    logger.warn({
      event: 'EXTERNAL_AUDIT_LOG_SKIPPED',
      reason: 'missing_subsystem_api_key',
      action_type: auditPayload.action_type,
      subsystem: auditPayload.subsystem,
    });
    return { sent: false, skipped: true, reason: 'missing_subsystem_api_key' };
  }

  const attempts = getRetryCount() + 1;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await axios.post(url, auditPayload, {
        timeout: getTimeoutMs(),
        headers: {
          'Content-Type': 'application/json',
          'X-Subsystem-Key': subsystemKey,
        },
        validateStatus: () => true,
      });

      if (response.status >= 200 && response.status < 300) {
        return { sent: true, status: response.status };
      }

      lastError = new Error(`Admin audit API returned HTTP ${response.status}`);
      lastError.status = response.status;
      lastError.responseBody = typeof response.data === 'string'
        ? response.data.slice(0, 500)
        : JSON.stringify(response.data || {}).slice(0, 500);

      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        break;
      }
    } catch (err) {
      lastError = err;
    }

    if (attempt < attempts) {
      await wait(150 * attempt);
    }
  }

  logger.error({
    event: 'EXTERNAL_AUDIT_LOG_FAILED',
    message: lastError?.message,
    status: lastError?.status || lastError?.response?.status,
    code: lastError?.code,
    action_type: auditPayload.action_type,
    subsystem: auditPayload.subsystem,
    responseBody: lastError?.responseBody,
  });

  return { sent: false, error: lastError?.message || 'External audit logging failed' };
};

const logAuditEvent = async (payload = {}) => {
  const auditPayload = buildAuditPayload(payload);

  if (!auditPayload.action_type || !auditPayload.subsystem) {
    logger.warn({ event: 'AUDIT_LOG_SKIPPED', reason: 'missing_action_type_or_subsystem', auditPayload });
    return null;
  }

  let localAuditLog = null;
  try {
    localAuditLog = await AuditLog.create(auditPayload);
  } catch (err) {
    logger.error({
      event: 'AUDIT_LOG_FAILED',
      message: err.message,
      action_type: payload.action_type || payload.action,
      subsystem: payload.subsystem || payload.entity_type,
    });
  }

  await sendAuditLog(auditPayload);
  return localAuditLog;
};

const withAuditSafety = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    logger.error({ event: 'AUDIT_LOG_FAILED', message: err.message });
    return null;
  }
};

const buildListFilter = (query = {}) => {
  const filter = {};
  if (query.action_type || query.action) filter.action_type = String(query.action_type || query.action).trim().toUpperCase();
  if (query.user_id || query.actor_user_id) filter.user_id = String(query.user_id || query.actor_user_id).trim();
  if (query.subsystem || query.entity_type) filter.subsystem = new RegExp(`^${escapeRegex(String(query.subsystem || query.entity_type).trim())}$`, 'i');

  const createdAt = {};
  if (query.start_date) {
    const start = new Date(`${query.start_date}T00:00:00.000Z`);
    if (!Number.isNaN(start.getTime())) createdAt.$gte = start;
  }
  if (query.end_date) {
    const end = new Date(`${query.end_date}T23:59:59.999Z`);
    if (!Number.isNaN(end.getTime())) createdAt.$lte = end;
  }
  if (Object.keys(createdAt).length) filter.created_at = createdAt;

  if (query.search) {
    const regex = new RegExp(String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const searchFilter = {
      $or: [
        { user_id: regex },
        { action_type: regex },
        { details: regex },
        { ip_addr: regex },
        { subsystem: regex },
      ],
    };

    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, searchFilter];
      delete filter.$or;
    } else {
      Object.assign(filter, searchFilter);
    }
  }

  return filter;
};

const getAuditLogs = async (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
  const skip = (page - 1) * limit;
  const filter = buildListFilter(query);

  const [total, auditLogs] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit),
  ]);

  return {
    auditLogs,
    results: auditLogs.length,
    pagination: { total, page, pages: Math.ceil(total / limit) || 1, limit },
  };
};

module.exports = {
  buildAuditPayload,
  buildActorFromRequest,
  diffValues,
  getAuditLogs,
  logAuditEvent,
  sanitizeAuditValue,
  sendAuditLog,
  withAuditSafety,
};
