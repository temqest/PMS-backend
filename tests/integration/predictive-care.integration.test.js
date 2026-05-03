const request = require('supertest');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
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
    const collections = await mongoose.connection.db.collections();
    for (const collection of collections) {
      await collection.deleteMany({});
    }
  });

  test('POST compute builds risk profile after lab record', async () => {
    const token = jwt.sign({ sub: 'admin-1', role: 'system_admin' }, process.env.JWT_SECRET);

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
