const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Patient = require('../../src/api/v1/patients/patient.model');
const Appointment = require('../../src/api/v1/appointments/appointment.model');
const appointmentService = require('../../src/api/v1/appointments/appointment.service');
const healthRecordService = require('../../src/api/v1/health-records/healthRecord.service');

describe('Relationship write guards', () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
    process.env.NODE_ENV = 'test';
    await mongoose.connect(process.env.MONGO_URI);
  }, 20000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();

    await Patient.insertMany([
      {
        patient_id: 'PAT-001',
        first_name: 'Alice',
        last_name: 'Patient',
        date_of_birth: new Date('1990-01-01'),
        gender: 'Female',
        contact_number: '555-1000',
        email_address: 'alice@example.com',
        address: '123 Main St',
        created_by: 'seed-script',
      },
      {
        patient_id: 'PAT-002',
        first_name: 'Bob',
        last_name: 'Patient',
        date_of_birth: new Date('1991-01-01'),
        gender: 'Male',
        contact_number: '555-2000',
        email_address: 'bob@example.com',
        address: '456 Main St',
        created_by: 'seed-script',
      },
    ]);
  });

  test('createAppointment requires an existing patient and canonicalizes patient_name', async () => {
    await expect(
      appointmentService.createAppointment(
        {
          patient_id: 'PAT-404',
          patient_name: 'Whoever',
          date: '2026-05-01',
          time: '09:00',
        },
        { id: 'actor-1', role: 'system_admin' }
      )
    ).rejects.toThrow('Patient not found.');

    const appointment = await appointmentService.createAppointment(
      {
        patient_id: 'PAT-001',
        patient_name: 'Wrong Name',
        date: '2026-05-01',
        time: '10:00',
      },
      { id: 'actor-1', role: 'system_admin' }
    );

    expect(appointment.patient_name).toBe('Alice Patient');
  });

  test('createHealthRecord rejects linked appointment mismatches', async () => {
    await Appointment.create({
      appointment_id: 'APT-001',
      patient_id: 'PAT-001',
      patient_name: 'Alice Patient',
      appointment_type: 'In-Person',
      scheduled_at: new Date('2026-05-01T09:00:00.000Z'),
      status: 'Confirmed',
    });

    await expect(
      healthRecordService.createHealthRecord(
        {
          patient_id: 'PAT-002',
          patient_name: 'Bob Patient',
          record_type: 'Visit',
          record_date: '2026-05-01T09:30:00.000Z',
          provider: 'Dr. Test',
          details: {
            visitReason: 'Follow-up',
            visitType: 'Follow-up',
            visitAssessment: 'Stable',
            appointmentId: 'APT-001',
          },
        },
        { id: 'actor-1', role: 'system_admin' }
      )
    ).rejects.toThrow('Linked appointment belongs to a different patient_id.');
  });
});
