const dayjs = require('dayjs');
const Patient = require('../api/v1/patients/patient.model');

const generatePatientId = async () => {
  const datePart = dayjs().format('YYYYMMDD');
  const prefix = `PAT-${datePart}-`;

  const count = await Patient.countDocuments({
    patient_id: { $regex: `^${prefix}` },
  });

  const sequence = String(count + 1).padStart(4, '0');
  return `${prefix}${sequence}`;
};

module.exports = generatePatientId;
