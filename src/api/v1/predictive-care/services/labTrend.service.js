const HealthRecord = require('../../health-records/healthRecord.model');
const LabTrend = require('../models/labTrend.model');
const CareAlert = require('../models/careAlert.model');

const LAB_STATUSES = new Set(['Normal', 'Abnormal', 'Critical']);

const normalizeLabStatus = (raw) => {
  if (!raw || typeof raw !== 'string') return 'Normal';
  const s = raw.trim();
  return LAB_STATUSES.has(s) ? s : 'Normal';
};

const computeLabTrendsForPatient = async (patient_id, patient_name) => {
  const labRecords = await HealthRecord.find({
    patient_id,
    record_type: 'Lab Result',
    save_state: 'final',
  }).sort({ record_date: 1 });

  if (!labRecords.length) return;

  const byTest = {};
  for (const record of labRecords) {
    const name = record.details?.labTestName;
    if (!name) continue;
    if (!byTest[name]) byTest[name] = [];

    const rawStr = record.details?.labResultValue != null ? String(record.details.labResultValue) : '';
    const fromNumeric =
      typeof record.details?.labResultNumeric === 'number' && Number.isFinite(record.details.labResultNumeric)
        ? record.details.labResultNumeric
        : NaN;
    const numericValue = Number.isFinite(fromNumeric)
      ? fromNumeric
      : parseFloat(rawStr.replace(/,/g, '').split(/\s+/)[0]);
    if (Number.isNaN(numericValue)) continue;

    byTest[name].push({
      record_id: record.record_id,
      value: numericValue,
      raw_value_string: rawStr,
      unit: record.details?.labUnit || '',
      status: normalizeLabStatus(record.details?.labStatus),
      recorded_at: record.record_date,
    });
  }

  for (const [testName, points] of Object.entries(byTest)) {
    const trend = computeTrend(points);
    const consecutiveAbnormal = countConsecutiveAbnormal(points);
    const lastPoint = points[points.length - 1];

    await LabTrend.findOneAndUpdate(
      { patient_id, test_name: testName },
      {
        patient_id,
        test_name: testName,
        data_points: points,
        trend_direction: trend.direction,
        trend_severity: trend.severity,
        consecutive_abnormal_count: consecutiveAbnormal,
        last_value: lastPoint.value,
        last_status: lastPoint.status,
        last_recorded_at: lastPoint.recorded_at,
        alert_triggered: consecutiveAbnormal >= 2 || trend.severity === 'Severe',
      },
      { upsert: true, returnDocument: 'after' }
    );

    if (consecutiveAbnormal >= 2) {
      await upsertLabAlert(patient_id, patient_name, testName, lastPoint, trend, consecutiveAbnormal);
    }
  }
};

const computeTrend = (points) => {
  if (points.length < 2) return { direction: 'Insufficient data', severity: 'None' };

  const recent = points.slice(-3);
  const first = recent[0].value;
  const last = recent[recent.length - 1].value;
  const changePct = ((last - first) / (Math.abs(first) || 1)) * 100;

  const abnormalCount = recent.filter((p) => p.status !== 'Normal').length;

  let direction = 'Stable';
  if (changePct > 15) direction = 'Worsening';
  else if (changePct < -15) direction = 'Improving';

  let severity = 'None';
  if (abnormalCount === recent.length && direction === 'Worsening') severity = 'Severe';
  else if (abnormalCount >= 2) severity = 'Moderate';
  else if (abnormalCount === 1) severity = 'Mild';

  return { direction, severity };
};

const countConsecutiveAbnormal = (points) => {
  let count = 0;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i].status !== 'Normal') count += 1;
    else break;
  }
  return count;
};

const upsertLabAlert = async (
  patient_id,
  patient_name,
  testName,
  lastPoint,
  trend,
  consecutiveCount
) => {
  const severity = consecutiveCount >= 3 ? 'Critical' : 'Warning';
  const statusLower = String(lastPoint.status || 'unknown').toLowerCase();
  await CareAlert.findOneAndUpdate(
    { patient_id, alert_type: 'LAB_TREND', 'metadata.test_name': testName, is_resolved: false },
    {
      patient_id,
      patient_name,
      alert_type: 'LAB_TREND',
      severity,
      title: `${testName} — ${trend.direction}`,
      message: `${testName} has been ${statusLower} for ${consecutiveCount} consecutive readings. Last value: ${lastPoint.raw_value_string}.`,
      metadata: {
        test_name: testName,
        trend_direction: trend.direction,
        last_value: lastPoint.raw_value_string,
        consecutive_abnormal: consecutiveCount,
      },
      triggered_at: new Date(),
      },
    { upsert: true, returnDocument: 'after' }
  );
};

module.exports = { computeLabTrendsForPatient };
