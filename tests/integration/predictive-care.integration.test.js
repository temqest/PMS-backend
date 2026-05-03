const request = require('supertest');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const axios = require('axios');
let app;
let mongoServer;

const samplePatientBody = {
  first_name: 'Predict',
  last_name: 'Care',
  date_of_birth: '1985-06-01',
  gender: 'Other',
  contact_number: '555-0111',
  email_address: 'predict.care@example.com',
  address: '456 Health Ave',
};

const createPatientWithLab = async (token) => {
  const createPatient = await request(app)
    .post('/api/v1/patients')
    .set('Authorization', `Bearer ${token}`)
    .send(samplePatientBody)
    .expect(201);

  const patientId = createPatient.body.data.patient.patient_id;
  const patientName = `${samplePatientBody.first_name} ${samplePatientBody.last_name}`;

  const HealthRecord = require('../../src/api/v1/health-records/healthRecord.model');
  await HealthRecord.create({
    record_id: 'hr-lab-' + Date.now(),
    patient_id: patientId,
    patient_name: patientName,
    record_type: 'Lab Result',
    record_date: new Date('2025-01-10'),
    provider: 'Dr. Test',
    save_state: 'final',
    details: {
      labTestName: 'Blood glucose',
      labResultValue: '120',
      labUnit: 'mg/dL',
      labStatus: 'Normal',
    },
  });

  return patientId;
};

describe('Predictive care integration', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
    process.env.NODE_ENV = 'test';

    await mongoose.connect(process.env.MONGO_URI);
    app = require('../../src/app');
  }, 20000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    const collections = await mongoose.connection.db.collections();
    for (const collection of collections) {
      await collection.deleteMany({});
    }
  });

  test('POST compute builds risk profile after lab record', async () => {
    const token = jwt.sign({ sub: 'admin-1', role: 'system_admin' }, process.env.JWT_SECRET);
    const patientId = await createPatientWithLab(token);

    await request(app)
      .post(`/api/v1/predictive-care/profiles/${patientId}/compute`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const profileRes = await request(app)
      .get(`/api/v1/predictive-care/profiles/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(profileRes.body.data.profile).toBeDefined();
    expect(profileRes.body.data.profile.patient_id).toBe(patientId);
  });

  test('POST compute merges ML fields when ML service responds', async () => {
    const token = jwt.sign({ sub: 'admin-ml-ok', role: 'system_admin' }, process.env.JWT_SECRET);
    const patientId = await createPatientWithLab(token);

    jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        patient_id: patientId,
        readmission: {
          readmission_score: 77.2,
          readmission_probability: 0.772,
          readmission_risk_level: 'High',
        },
        chronic_risk: {
          chronic_risk_score: 66.1,
          chronic_risk_level: 'High',
          confidence: 0.81,
          top_factors: [{ feature: 'high_bp_count', importance: 0.37 }],
        },
        anomaly: {
          is_anomaly: true,
          anomaly_score: 84.5,
        },
      },
    });

    const computeRes = await request(app)
      .post(`/api/v1/predictive-care/profiles/${patientId}/compute`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(computeRes.body.data.profile.ml_service_used).toBe(true);
    expect(computeRes.body.data.profile.ml_readmission_level).toBe('High');
    expect(computeRes.body.data.profile.ml_is_anomaly).toBe(true);

    const profileRes = await request(app)
      .get(`/api/v1/predictive-care/profiles/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(profileRes.body.data.profile.ml_service_used).toBe(true);
    expect(profileRes.body.data.profile.ml_readmission_prob).toBeCloseTo(0.772);
    expect(profileRes.body.data.profile.ml_chronic_confidence).toBeCloseTo(0.81);
    expect(profileRes.body.data.profile.ml_top_risk_factors).toHaveLength(1);
  });

  test('POST compute falls back to rule-based profile when ML service is unavailable', async () => {
    const token = jwt.sign({ sub: 'admin-ml-down', role: 'system_admin' }, process.env.JWT_SECRET);
    const patientId = await createPatientWithLab(token);

    jest.spyOn(axios, 'get').mockRejectedValue({ code: 'ECONNREFUSED' });

    const computeRes = await request(app)
      .post(`/api/v1/predictive-care/profiles/${patientId}/compute`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(computeRes.body.data.profile).toBeDefined();
    expect(computeRes.body.data.profile.patient_id).toBe(patientId);
    expect(computeRes.body.data.profile.ml_service_used).toBe(false);
    expect(computeRes.body.data.profile.ml_readmission_prob).toBeUndefined();
    expect(computeRes.body.data.profile.ml_computed_at).toBeUndefined();
  });

  test('POST profiles/compute-all does not collide with patientId route', async () => {
    const token = jwt.sign({ sub: 'admin-2', role: 'system_admin' }, process.env.JWT_SECRET);

    await request(app)
      .post('/api/v1/predictive-care/profiles/compute-all')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(
      (
        await request(app)
          .post('/api/v1/predictive-care/profiles/compute-all/not-a-route')
          .set('Authorization', `Bearer ${token}`)
      ).status
    ).toBe(404);
  });
});
