const dayjs = require('dayjs');
const HealthRecord = require('../../health-records/healthRecord.model');
const CareAlert = require('../models/careAlert.model');
const PatientRiskProfile = require('../models/patientRiskProfile.model');

const checkVaccinationGapsForPatient = async (patient_id, patient_name) => {
  const vaccinationRecords = await HealthRecord.find({
    patient_id,
    record_type: 'Vaccination',
    save_state: 'final',
  }).sort({ record_date: -1 });

  const today = dayjs();
  const alerts = [];

  for (const record of vaccinationRecords) {
    const { vaccinationName, vaccinationSeriesComplete, vaccinationNextDoseDue } = record.details || {};

    if (!vaccinationSeriesComplete && vaccinationNextDoseDue) {
      const dueDate = dayjs(vaccinationNextDoseDue);
      if (!dueDate.isValid()) continue;

      const daysOverdue = today.diff(dueDate, 'day');

      if (daysOverdue > 0) {
        alerts.push({
          name: vaccinationName,
          daysOverdue,
          nextDoseDue: vaccinationNextDoseDue,
        });

        await CareAlert.findOneAndUpdate(
          {
            patient_id,
            alert_type: 'VACCINATION_GAP',
            'metadata.vaccine_name': vaccinationName,
            is_resolved: false,
          },
          {
            patient_id,
            patient_name,
            alert_type: 'VACCINATION_GAP',
            severity: daysOverdue > 90 ? 'Critical' : daysOverdue > 30 ? 'Warning' : 'Info',
            title: `${vaccinationName} dose overdue`,
            message: `Next dose of ${vaccinationName} was due ${daysOverdue} day(s) ago (${vaccinationNextDoseDue}). Series is incomplete.`,
            metadata: {
              vaccine_name: vaccinationName,
              days_overdue: daysOverdue,
              next_dose_due: vaccinationNextDoseDue,
            },
            triggered_at: new Date(),
          },
          { upsert: true, new: true }
        );
      }
    }
  }

  await PatientRiskProfile.findOneAndUpdate(
    { patient_id },
    { has_overdue_vaccinations: alerts.length > 0 },
    { upsert: true }
  );

  return alerts;
};

module.exports = { checkVaccinationGapsForPatient };
