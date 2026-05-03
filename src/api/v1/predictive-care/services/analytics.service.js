const PatientRiskProfile = require('../models/patientRiskProfile.model');
const CareAlert = require('../models/careAlert.model');
const LabTrend = require('../models/labTrend.model');
const AdherenceRecord = require('../models/adherenceRecord.model');

const getDashboardSummary = async () => {
  const [riskDistribution, alertCounts, topHighRisk] = await Promise.all([
    PatientRiskProfile.aggregate([{ $group: { _id: '$overall_risk_level', count: { $sum: 1 } } }]),
    CareAlert.aggregate([
      { $match: { is_resolved: false } },
      { $group: { _id: '$alert_type', count: { $sum: 1 } } },
    ]),
    PatientRiskProfile.find({ overall_risk_level: { $in: ['High', 'Critical'] } })
      .sort({ overall_risk_score: -1 })
      .limit(10)
      .select('patient_id patient_name overall_risk_score overall_risk_level')
      .lean(),
  ]);

  return { riskDistribution, alertCounts, topHighRisk };
};

const getLabTrendChartData = async (patient_id) => {
  const trends = await LabTrend.find({ patient_id });
  return trends.map((t) => ({
    test_name: t.test_name,
    trend_direction: t.trend_direction,
    trend_severity: t.trend_severity,
    chart_data: t.data_points.map((p) => ({
      date: p.recorded_at,
      value: p.value,
      status: p.status,
    })),
  }));
};

const getPatientRiskRadar = async (patient_id) => {
  const profile = await PatientRiskProfile.findOne({ patient_id });
  if (!profile) return null;
  return {
    patient_id,
    patient_name: profile.patient_name,
    radar: [
      { axis: 'Chronic Disease', value: profile.chronic_disease_risk },
      { axis: 'Readmission', value: profile.readmission_risk },
      { axis: 'No-show', value: profile.no_show_risk },
      { axis: 'Adherence', value: profile.adherence_risk },
    ],
    overall_score: profile.overall_risk_score,
    overall_risk_level: profile.overall_risk_level,
  };
};

const getPatientAdherenceChartData = async (patient_id) => {
  const records = await AdherenceRecord.find({ patient_id });
  return records.map((r) => ({
    medicine: r.medicine_name,
    score: r.adherence_score,
    status: r.status,
    longest_gap_days: r.longest_gap_days,
  }));
};

const getPatientAlertTimeline = async (patient_id) => {
  const alerts = await CareAlert.find({ patient_id }).sort({ triggered_at: -1 }).limit(50);
  return alerts.map((a) => ({
    date: a.triggered_at,
    type: a.alert_type,
    severity: a.severity,
    title: a.title,
    is_resolved: a.is_resolved,
  }));
};

module.exports = {
  getDashboardSummary,
  getLabTrendChartData,
  getPatientRiskRadar,
  getPatientAdherenceChartData,
  getPatientAlertTimeline,
};
