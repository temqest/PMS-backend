const Joi = require('joi');

const recordTypes = ['Visit', 'Lab Result', 'Imaging', 'Prescription', 'Vaccination', 'Note'];
const saveStates = ['draft', 'final'];
const visitTypes = ['Follow-up', 'Annual Physical', 'Urgent', 'Consultation', 'Procedure'];
const visitDispositions = ['Routine', 'Urgent', 'Referred', 'Observation', 'Other'];
const labStatuses = ['Normal', 'Abnormal', 'Critical'];
const imagingTypes = ['X-Ray', 'CT', 'MRI', 'Ultrasound', 'PET', 'Mammography'];
const prescriptionForms = ['Tablet', 'Capsule', 'Liquid', 'Injection', 'Topical'];
const vaccinationSites = ['Left Arm', 'Right Arm', 'Left Thigh', 'Right Thigh', 'Other'];
const vaccinationRoutes = ['Intramuscular', 'Subcutaneous', 'Oral', 'Nasal'];
const noteTypes = ['Progress Note', 'Consultation Note', 'Nursing Note', 'Discharge Summary', 'Phone Call'];

const prescriptionMedicineSchema = Joi.object({
  medicineId: Joi.string().trim().required(),
  medicineName: Joi.string().trim().required(),
  prescribedDosage: Joi.string().trim().required(),
  availableQuantity: Joi.number().integer().min(0).required(),
  prescribedQuantity: Joi.number().integer().min(1).required(),
  unitPrice: Joi.number().min(0).required(),
  totalPrice: Joi.number().min(0).required(),
  expiry: Joi.string().trim().allow('').optional(),
  status: Joi.string().trim().allow('').optional(),
}).unknown(true);

const prescriptionDetailsSchema = Joi.object({
  title: Joi.string().trim().optional(),
  summary: Joi.string().trim().allow('').optional(),
  medicines: Joi.array().items(prescriptionMedicineSchema).min(1).required(),
  medicationName: Joi.string().trim().optional(),
  dosage: Joi.string().trim().optional(),
  form: Joi.string().trim().optional(),
  directionsForUse: Joi.string().trim().required(),
  quantity: Joi.number().integer().min(1).required(),
  refills: Joi.number().integer().min(0).optional(),
  pharmacy: Joi.string().trim().allow('').optional(),
  startDate: Joi.string().trim().allow('').optional(),
  endDate: Joi.string().trim().allow('').optional(),
  substitutionAllowed: Joi.boolean().optional(),
  notes: Joi.string().trim().allow('').optional(),
}).unknown(true);

const prescriptionFormDetailsSchema = Joi.object({
  title: Joi.string().trim().optional(),
  summary: Joi.string().trim().allow('').optional(),
  prescriptionMedicationName: Joi.string().trim().required(),
  prescriptionDosage: Joi.string().trim().required(),
  prescriptionForm: Joi.string().valid(...prescriptionForms).optional(),
  prescriptionDirections: Joi.string().trim().required(),
  prescriptionQuantity: Joi.string().trim().allow('').optional(),
  prescriptionRefills: Joi.string().trim().allow('').optional(),
  prescriptionPharmacy: Joi.string().trim().allow('').optional(),
  prescriptionStartDate: Joi.string().trim().allow('').optional(),
  prescriptionEndDate: Joi.string().trim().allow('').optional(),
  substitutionAllowed: Joi.boolean().optional(),
  prescriptionNotes: Joi.string().trim().allow('').optional(),
}).unknown(true);

const visitDetailsSchema = Joi.object({
  title: Joi.string().trim().optional(),
  summary: Joi.string().trim().allow('').optional(),
  visitReason: Joi.string().trim().required(),
  visitType: Joi.string().valid(...visitTypes).required(),
  chiefComplaint: Joi.string().trim().allow('').max(500).optional(),
  visitDisposition: Joi.string().valid(...visitDispositions).allow('').optional(),
  followUpDueDate: Joi.string().trim().allow('').optional(),
  visitBpSystolic: Joi.string().trim().allow('').optional(),
  visitBpDiastolic: Joi.string().trim().allow('').optional(),
  visitHeartRate: Joi.string().trim().allow('').optional(),
  visitRespiratoryRate: Joi.string().trim().allow('').optional(),
  visitTemperature: Joi.string().trim().allow('').optional(),
  visitWeight: Joi.string().trim().allow('').optional(),
  visitHeight: Joi.string().trim().allow('').optional(),
  visitAssessment: Joi.string().trim().allow('').optional(),
  appointmentId: Joi.string().trim().allow('').optional(),
}).unknown(true).required();

const labDetailsSchema = Joi.object({
  title: Joi.string().trim().optional(),
  summary: Joi.string().trim().allow('').optional(),
  labTestName: Joi.string().trim().required(),
  labResultValue: Joi.string().trim().required(),
  labUnit: Joi.string().trim().allow('').optional(),
  labReferenceRange: Joi.string().trim().allow('').optional(),
  labStatus: Joi.when('labResultValue', {
    is: Joi.string().trim().min(1),
    then: Joi.string().valid(...labStatuses).required(),
    otherwise: Joi.string().valid(...labStatuses).optional(),
  }),
  labResultNumeric: Joi.number().optional(),
  labFlagForReview: Joi.boolean().optional(),
  labOrderingProvider: Joi.string().trim().allow('').optional(),
  labNotes: Joi.string().trim().allow('').optional(),
}).unknown(true).required();

const imagingDetailsSchema = Joi.object({
  title: Joi.string().trim().optional(),
  summary: Joi.string().trim().allow('').optional(),
  imagingStudyType: Joi.string().valid(...imagingTypes).required(),
  imagingBodyPart: Joi.string().trim().allow('').optional(),
  imagingFindings: Joi.string().trim().required(),
  imagingImpression: Joi.string().trim().allow('').optional(),
  imagingFiles: Joi.array()
    .items(
      Joi.object({
        id: Joi.string().trim().required(),
        name: Joi.string().trim().required(),
        size: Joi.number().integer().min(0).required(),
      }).unknown(true)
    )
    .optional(),
  imagingRadiologist: Joi.string().trim().allow('').optional(),
}).unknown(true).required();

const vaccinationDetailsSchema = Joi.object({
  title: Joi.string().trim().optional(),
  summary: Joi.string().trim().allow('').optional(),
  vaccinationName: Joi.string().trim().required(),
  vaccinationLotNumber: Joi.string().trim().allow('').optional(),
  vaccinationExpirationDate: Joi.string().trim().required(),
  vaccinationSite: Joi.string().valid(...vaccinationSites).optional(),
  vaccinationRoute: Joi.string().valid(...vaccinationRoutes).optional(),
  vaccinationDoseNumber: Joi.string().trim().allow('').optional(),
  vaccinationSeriesComplete: Joi.boolean().optional(),
  vaccinationNextDoseDue: Joi.string().trim().allow('').optional(),
  vaccinationVisGiven: Joi.boolean().optional(),
  vaccinationAdministeredBy: Joi.string().trim().allow('').optional(),
  vaccinationNotes: Joi.string().trim().allow('').optional(),
}).unknown(true).required();

const noteDetailsSchema = Joi.object({
  title: Joi.string().trim().optional(),
  summary: Joi.string().trim().allow('').optional(),
  noteType: Joi.string().valid(...noteTypes).required(),
  noteContent: Joi.string().trim().required(),
  noteIsAddendum: Joi.boolean().optional(),
  previousNote: Joi.string().trim().allow('').optional(),
}).unknown(true).required();

const createHealthRecordSchema = Joi.object({
  patient_id: Joi.string().trim().required(),
  patient_name: Joi.string().trim().required(),
  record_type: Joi.string().valid(...recordTypes).required(),
  record_date: Joi.string().trim().required(),
  provider: Joi.string().trim().required(),
  provider_id: Joi.string().trim().allow('').optional(),
  save_state: Joi.string().valid(...saveStates).default('final'),
  summary: Joi.string().trim().allow('').default(''),
  details: Joi.when('record_type', {
    switch: [
      { is: 'Visit', then: visitDetailsSchema },
      { is: 'Lab Result', then: labDetailsSchema },
      { is: 'Imaging', then: imagingDetailsSchema },
      { is: 'Prescription', then: Joi.alternatives().try(prescriptionDetailsSchema, prescriptionFormDetailsSchema) },
      { is: 'Vaccination', then: vaccinationDetailsSchema },
      { is: 'Note', then: noteDetailsSchema },
    ],
    otherwise: Joi.object().unknown(true).default({}),
  }),
});

const updateHealthRecordSchema = Joi.object({
  patient_id: Joi.string().trim().optional(),
  patient_name: Joi.string().trim().optional(),
  record_type: Joi.string().valid(...recordTypes).optional(),
  record_date: Joi.string().trim().optional(),
  provider: Joi.string().trim().optional(),
  provider_id: Joi.string().trim().allow('').optional(),
  save_state: Joi.string().valid(...saveStates).optional(),
  summary: Joi.string().trim().allow('').optional(),
  details: Joi.object().unknown(true).optional(),
  __v: Joi.number().integer().min(0).optional(),
  record_id: Joi.forbidden(),
  archived: Joi.forbidden(),
  archived_at: Joi.forbidden(),
  created_by: Joi.forbidden(),
  updated_by: Joi.forbidden(),
}).custom((value, helpers) => {
  if (value.record_type === 'Prescription' && typeof value.details !== 'undefined') {
    const { error } = Joi.alternatives().try(prescriptionDetailsSchema, prescriptionFormDetailsSchema).validate(value.details || {});
    if (error) return helpers.error('any.invalid', { message: error.message });
  }
  return value;
}).min(1);

module.exports = {
  createHealthRecordSchema,
  updateHealthRecordSchema,
  visitDispositions,
  labStatuses,
};
