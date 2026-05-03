const request = require('supertest');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let app;
let mongoServer;

const samplePatient = {
  first_name: 'Test',
  last_name: 'User',
  date_of_birth: '1990-01-01',
  gender: 'Other',
  contact_number: '555-0000',
  email_address: 'test.user@example.com',
  address: '123 Test St',
};

describe('Patients integration (API) tests', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
    process.env.NODE_ENV = 'test';

    // connect directly with mongoose to the in-memory server
    const uri = process.env.MONGO_URI;
    await mongoose.connect(uri);

    // require app after MONGO_URI is set and DB connect function available
    app = require('../../src/app');
  }, 20000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  afterEach(async () => {
    const collections = await mongoose.connection.db.collections();
    for (let collection of collections) {
      await collection.deleteMany({});
    }
  });

  test('register patient -> created_by set and patient returned', async () => {
    const token = jwt.sign({ sub: 'actor-1', role: 'system_admin' }, process.env.JWT_SECRET);

    const res = await request(app)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${token}`)
      .send(samplePatient)
      .expect(201);

    expect(res.body).toHaveProperty('data.patient');
    const patient = res.body.data.patient;
    expect(patient).toHaveProperty('patient_id');
    expect(patient.created_by).toBe('actor-1');
  });

  test('get patient by id -> view audit (response ok)', async () => {
    const token = jwt.sign({ sub: 'actor-2', role: 'system_admin' }, process.env.JWT_SECRET);

    // create first
    const create = await request(app)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${token}`)
      .send(samplePatient)
      .expect(201);

    const patientId = create.body.data.patient.patient_id;

    const res = await request(app)
      .get(`/api/v1/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveProperty('data.patient');
    expect(res.body.data.patient.patient_id).toBe(patientId);
  });
});
