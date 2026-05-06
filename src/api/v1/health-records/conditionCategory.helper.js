const CONDITION_KEYWORD_CATEGORIES = {
  cardiovascular: [
    'hypertension',
    'heart disease',
    'heart failure',
    'arrhythmia',
    'stroke',
    'coronary artery disease',
  ],
  metabolic: [
    'diabetes',
    'type 1 diabetes',
    'type 2 diabetes',
    'prediabetes',
    'metabolic syndrome',
    'hyperlipidemia',
  ],
  respiratory: [
    'asthma',
    'copd',
    'pneumonia',
    'bronchitis',
    'respiratory infection',
  ],
  renal: [
    'kidney disease',
    'renal disease',
    'chronic kidney disease',
    'ckd',
    'nephropathy',
  ],
  mental_health: [
    'depression',
    'anxiety',
    'bipolar',
    'mental health',
    'panic disorder',
  ],
  cancer: [
    'cancer',
    'carcinoma',
    'tumor',
    'oncology',
    'leukemia',
  ],
};

const CONDITION_CATEGORIES = [
  ...Object.keys(CONDITION_KEYWORD_CATEGORIES),
  'uncategorized',
];

const collectDiagnosisText = (payload = {}) => {
  const details = payload.details && typeof payload.details === 'object' ? payload.details : {};
  return [
    payload.summary,
    details.summary,
    details.title,
    details.visitAssessment,
    details.visitReason,
    details.chiefComplaint,
    details.labNotes,
    details.imagingImpression,
    details.imagingFindings,
    details.noteContent,
    details.noteType,
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
    .toLowerCase();
};

const categorizeCondition = (payload = {}) => {
  const diagnosisText = collectDiagnosisText(payload);
  if (!diagnosisText) return 'uncategorized';

  for (const [category, keywords] of Object.entries(CONDITION_KEYWORD_CATEGORIES)) {
    if (keywords.some((keyword) => diagnosisText.includes(keyword.toLowerCase()))) {
      return category;
    }
  }

  return 'uncategorized';
};

module.exports = {
  CONDITION_KEYWORD_CATEGORIES,
  CONDITION_CATEGORIES,
  categorizeCondition,
};
