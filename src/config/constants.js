const ROLES = {
  SYSTEM_ADMIN: 'system_admin',
  FRONT_DESK: 'front_desk',
  PHYSICIAN: 'physician',
  BILLING_SYSTEM: 'billing_system',
  APPOINTMENT_SYSTEM: 'appointment_system',
  EMR_SYSTEM: 'emr_system',
  PREDICTIVE_ANALYTICS: 'predictive_analytics',
  PATIENT: 'patient',
};

const PERMISSIONS = {
  system_admin: [
    'register',
    'view',
    'view:limited',
    'view:anonymized',
    'view:own',
    'create:own',
    'update',
    'update:medical',
    'update:emr_ref',
    'update:appointment_ref',
    'update:own',
    'soft_delete',
    'analytics',
  ],
  front_desk: ['register', 'view', 'update'],
  physician: ['view', 'update:medical'],
  billing_system: ['view:limited'],
  appointment_system: ['view:limited', 'update:appointment_ref'],
  emr_system: ['view:limited', 'update:emr_ref'],
  predictive_analytics: ['view:anonymized', 'analytics'],
  patient: ['view:own', 'create:own', 'update:own'],
  user: ['register', 'view', 'update'],
};

module.exports = { ROLES, PERMISSIONS };
