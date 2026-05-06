/**
 * Canonical health-record `details` normalization (per record_type).
 * Keeps legacy keys; adds stable derived fields for ML and predictive care.
 */

const LAB_STATUSES = new Set(['Normal', 'Abnormal', 'Critical']);
const VISIT_DISPOSITIONS = new Set(['Routine', 'Urgent', 'Referred', 'Observation', 'Other']);

const parseLabNumeric = (raw) => {
  if (raw == null || raw === '') return null;
  const n = parseFloat(String(raw).replace(/,/g, '').split(/\s+/)[0]);
  return Number.isFinite(n) ? n : null;
};

const normalizeVisitDetails = (details = {}) => {
  const d = { ...details };
  if (typeof d.chiefComplaint === 'string') d.chiefComplaint = d.chiefComplaint.trim().slice(0, 500);
  if (typeof d.visitDisposition === 'string') {
    const v = d.visitDisposition.trim();
    d.visitDisposition = VISIT_DISPOSITIONS.has(v) ? v : '';
  }
  if (typeof d.followUpDueDate === 'string') d.followUpDueDate = d.followUpDueDate.trim().slice(0, 32);
  return d;
};

const normalizeLabDetails = (details = {}) => {
  const d = { ...details };
  const valueStr = d.labResultValue != null ? String(d.labResultValue).trim() : '';
  const numeric = parseLabNumeric(valueStr);
  if (numeric != null) d.labResultNumeric = numeric;
  else if (d.labResultNumeric !== undefined) delete d.labResultNumeric;

  let status = typeof d.labStatus === 'string' ? d.labStatus.trim() : '';
  if (!LAB_STATUSES.has(status)) {
    status = valueStr ? 'Normal' : '';
  }
  if (status) d.labStatus = status;
  return d;
};

const normalizeImagingDetails = (details = {}) => ({ ...details });

const normalizeVaccinationDetails = (details = {}) => ({ ...details });

const normalizeNoteDetails = (details = {}) => ({ ...details });

/**
 * @param {string} recordType
 * @param {object} details
 * @returns {object}
 */
function normalizeHealthRecordDetails(recordType, details) {
  const base = details && typeof details === 'object' ? details : {};
  switch (recordType) {
    case 'Visit':
      return normalizeVisitDetails(base);
    case 'Lab Result':
      return normalizeLabDetails(base);
    case 'Imaging':
      return normalizeImagingDetails(base);
    case 'Vaccination':
      return normalizeVaccinationDetails(base);
    case 'Note':
      return normalizeNoteDetails(base);
    default:
      return { ...base };
  }
}

module.exports = {
  normalizeHealthRecordDetails,
  VISIT_DISPOSITIONS,
  LAB_STATUSES,
};
