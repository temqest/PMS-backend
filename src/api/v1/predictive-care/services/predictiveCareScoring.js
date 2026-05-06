/**
 * Single definition for overall predictive-care score (0–100) and level.
 * Weights align rule-based components: chronic burden, utilization/readmission proxy,
 * no-show, adherence.
 */
const WEIGHTS = {
  chronic: 0.35,
  readmission: 0.25,
  noShow: 0.15,
  adherence: 0.25,
};

const overallRiskLevel = (score) => {
  if (score >= 75) return 'Critical';
  if (score >= 50) return 'High';
  if (score >= 25) return 'Moderate';
  return 'Low';
};

const overallRiskScore = (chronic, readmission, noShow, adherence) => {
  const c = Number(chronic) || 0;
  const r = Number(readmission) || 0;
  const n = Number(noShow) || 0;
  const a = Number(adherence) || 0;
  return Math.round(
    c * WEIGHTS.chronic + r * WEIGHTS.readmission + n * WEIGHTS.noShow + a * WEIGHTS.adherence
  );
};

module.exports = {
  WEIGHTS,
  overallRiskScore,
  overallRiskLevel,
};
