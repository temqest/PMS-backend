const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../../src/app');
const ApiKey = require('../../src/api/v1/api-keys/apiKey.model');
const Appointment = require('../../src/api/v1/appointments/appointment.model');

describe('External appointment access', () => {
  let mongoServer;
  const apiKeyValue = 'sk_live_test_read_appointments_key_1234567890';

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
    process.env.NODE_ENV = 'test';

    await mongoose.connect(process.env.MONGO_URI);
  }, 20000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();

    await ApiKey.create({
      name: 'External appointment reader',
      keyHash: ApiKey.hashApiKey(apiKeyValue),
      prefix: apiKeyValue.slice(0, 8),
      description: 'Integration test key for appointments',
      status: 'active',
      permissions: ['read:appointments'],
      created_by: 'test-admin',
    });

    await Appointment.insertMany([
      {
        appointment_id: 'APT-001',
        patient_id: 'PAT-001',
        patient_name: 'Alice Patient',
        appointment_type: 'In-Person',
        scheduled_at: new Date('2026-05-01T09:00:00.000Z'),
        duration_minutes: 30,
        reason: 'Follow-up',
        priority: 'Routine',
        status: 'Confirmed',
      },
      {
        appointment_id: 'APT-002',
        patient_id: 'PAT-002',
        patient_name: 'Bob Patient',
        appointment_type: 'Telehealth',
        scheduled_at: new Date('2026-05-02T10:00:00.000Z'),
        duration_minutes: 45,
        reason: 'Consultation',
        priority: 'Urgent',
        status: 'Pending',
      },
      {
        appointment_id: 'APT-003',
        patient_id: 'PAT-001',
        patient_name: 'Alice Patient',
        appointment_type: 'In-Person',
        scheduled_at: new Date('2026-05-03T11:00:00.000Z'),
        duration_minutes: 15,
        reason: 'Lab review',
        priority: 'Follow-up',
        status: 'Completed',
      },
    ]);
  });

  test('GET /api/v1/external/appointments returns all appointments', async () => {
    const res = await request(app)
      .get('/api/v1/external/appointments')
      .set('x-api-key', apiKeyValue)
      .expect(200);

    expect(res.body.data.appointments).toHaveLength(3);
    expect(res.body.results).toBe(3);
    expect(res.body.pagination.total).toBe(3);
  });

  test('GET /api/v1/external/patients/:id/appointments returns patient appointments only', async () => {
    const res = await request(app)
      .get('/api/v1/external/patients/PAT-001/appointments')
      .set('x-api-key', apiKeyValue)
      .expect(200);

    expect(res.body.data.appointments).toHaveLength(2);
    expect(res.body.data.appointments.every((appointment) => appointment.patient_id === 'PAT-001')).toBe(true);
    expect(res.body.pagination.total).toBe(2);
  });

  test('GET appointments rejects missing permission', async () => {
    await ApiKey.deleteMany({});

    await ApiKey.create({
      name: 'Invoices only key',
      keyHash: ApiKey.hashApiKey(apiKeyValue),
      prefix: apiKeyValue.slice(0, 8),
      description: 'No appointment access',
      status: 'active',
      permissions: ['read:invoices'],
      created_by: 'test-admin',
    });

    const res = await request(app)
      .get('/api/v1/external/appointments')
      .set('x-api-key', apiKeyValue)
      .expect(403);

    expect(res.body.message).toMatch(/permission/i);
  });
});
