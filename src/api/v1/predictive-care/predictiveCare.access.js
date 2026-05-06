const AppError = require('../../../utils/AppError');

const isPatientActor = (req) => req.user?.role === 'patient';

const getActorPatientId = (req) => String(req.user?.patient_id || '').trim();

const ensurePatientOwnsParam = (req, paramName = 'patientId') => {
  if (!isPatientActor(req)) return;

  const actorPatientId = getActorPatientId(req);
  const requestedPatientId = String(req.params?.[paramName] || '').trim();

  if (!actorPatientId || requestedPatientId !== actorPatientId) {
    throw new AppError('Forbidden: cannot access another patient predictive record.', 403);
  }
};

const rejectPatientAccess = (req, message = 'Forbidden: this predictive analytics endpoint is staff-only.') => {
  if (isPatientActor(req)) {
    throw new AppError(message, 403);
  }
};

const patientScopedFilter = (req, baseFilter = {}) => {
  if (!isPatientActor(req)) return { ...baseFilter };

  const actorPatientId = getActorPatientId(req);
  if (!actorPatientId) {
    throw new AppError('Forbidden: patient account is not linked to a chart.', 403);
  }

  return { ...baseFilter, patient_id: actorPatientId };
};

module.exports = {
  ensurePatientOwnsParam,
  isPatientActor,
  patientScopedFilter,
  rejectPatientAccess,
};
