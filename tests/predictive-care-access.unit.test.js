const {
  ensurePatientOwnsParam,
  patientScopedFilter,
  rejectPatientAccess,
} = require('../src/api/v1/predictive-care/predictiveCare.access');

describe('predictive care patient access guards', () => {
  test('allows patient access to their own predictive record', () => {
    const req = { user: { role: 'patient', patient_id: 'PAT-001' }, params: { patientId: 'PAT-001' } };

    expect(() => ensurePatientOwnsParam(req)).not.toThrow();
  });

  test('rejects patient access to another patient predictive record', () => {
    const req = { user: { role: 'patient', patient_id: 'PAT-001' }, params: { patientId: 'PAT-002' } };

    expect(() => ensurePatientOwnsParam(req)).toThrow('Forbidden');
  });

  test('leaves staff patient-specific access unchanged', () => {
    const req = { user: { role: 'physician' }, params: { patientId: 'PAT-002' } };

    expect(() => ensurePatientOwnsParam(req)).not.toThrow();
  });

  test('forces alert filters to the linked patient for patient users', () => {
    const req = { user: { role: 'patient', patient_id: 'PAT-001' } };

    expect(patientScopedFilter(req, { patient_id: 'PAT-002', severity: 'Critical' })).toEqual({
      patient_id: 'PAT-001',
      severity: 'Critical',
    });
  });

  test('rejects patient access to staff-only predictive endpoints', () => {
    const req = { user: { role: 'patient', patient_id: 'PAT-001' } };

    expect(() => rejectPatientAccess(req)).toThrow('staff-only');
  });
});
