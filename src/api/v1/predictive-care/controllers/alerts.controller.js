const asyncHandler = require('../../../../utils/asyncHandler');
const apiResponse = require('../../../../utils/apiResponse');
const AppError = require('../../../../utils/AppError');
const CareAlert = require('../models/careAlert.model');
const { isPatientActor, patientScopedFilter } = require('../predictiveCare.access');

exports.getAlerts = asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 20;
  const page = parseInt(req.query.page, 10) || 1;
  const filter = isPatientActor(req) ? patientScopedFilter(req) : {};
  if (!isPatientActor(req) && req.query.patient_id) filter.patient_id = req.query.patient_id;
  if (req.query.alert_type) filter.alert_type = req.query.alert_type;
  if (req.query.severity) filter.severity = req.query.severity;
  if (req.query.is_resolved !== undefined)
    filter.is_resolved = req.query.is_resolved === 'true' || req.query.is_resolved === true;

  const [alerts, total] = await Promise.all([
    CareAlert.find(filter)
      .sort({ triggered_at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    CareAlert.countDocuments(filter),
  ]);

  apiResponse.success(res, 200, { alerts }, { total, page, limit });
});

exports.resolveAlert = asyncHandler(async (req, res) => {
  const alert = await CareAlert.findByIdAndUpdate(
    req.params.id,
    {
      is_resolved: true,
      resolved_at: new Date(),
      resolved_by: req.body.resolved_by || 'staff',
    },
    { returnDocument: 'after' }
  );
  if (!alert) {
    throw new AppError('Alert not found.', 404);
  }
  apiResponse.success(res, 200, { alert });
});

exports.markAlertRead = asyncHandler(async (req, res) => {
  const alert = await CareAlert.findByIdAndUpdate(req.params.id, { is_read: true }, { returnDocument: 'after' });
  if (!alert) {
    throw new AppError('Alert not found.', 404);
  }
  apiResponse.success(res, 200, { alert });
});
