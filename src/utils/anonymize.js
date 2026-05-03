const crypto = require('crypto');

function shortHash(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 12);
}

function anonymizePatient(doc) {
  if (!doc) return doc;
  // Accept Mongoose doc or plain object
  const p = doc.toObject ? doc.toObject() : Object.assign({}, doc);

  const anon = {
    patient_id: `ANON-${shortHash(p.patient_id || p._id || '')}`,
    gender: p.gender,
    status: p.status,
    visit_count: p.visit_count,
    last_visit_date: p.last_visit_date,
    attending_physician: p.attending_physician,
    // Keep non-PII references (IDs) but do not expose PII fields
    medical_history_ref: p.medical_history_ref ? `REF-${shortHash(p.medical_history_ref)}` : undefined,
    appointment_refs_count: Array.isArray(p.appointment_refs) ? p.appointment_refs.length : undefined,
    billing_refs_count: Array.isArray(p.billing_refs) ? p.billing_refs.length : undefined,
    registration_date: p.registration_date,
  };

  return anon;
}

function anonymizePatients(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr.map(anonymizePatient);
}

module.exports = { anonymizePatient, anonymizePatients };
