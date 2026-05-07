const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Patient = require('../../src/api/v1/patients/patient.model');
const User = require('../../src/api/v1/auth/user.model');
const Appointment = require('../../src/api/v1/appointments/appointment.model');
const HealthRecord = require('../../src/api/v1/health-records/healthRecord.model');
const PrescriptionInvoice = require('../../src/api/v1/prescription-invoices/prescriptionInvoice.model');
const { auditRelationships, applyRepairs } = require('../../scripts/lib/relationshipAudit');

describe('Relationship audit and repair flow', () => {
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

    await Patient.create({
      patient_id: 'PAT-001',
      first_name: 'Alice',
      last_name: 'Patient',
      date_of_birth: new Date('1990-01-01'),
      gender: 'Female',
      contact_number: '555-1000',
      email_address: 'alice@example.com',
      address: '123 Main St',
      created_by: 'seed-script',
      appointment_refs: [],
      billing_refs: [],
      medical_history_ref: '',
    });

    await User.create({
      email: 'alice@example.com',
      password_hash: 'hash',
      role: 'patient',
      patient_id: null,
      fullName: 'Alice Patient',
      is_active: true,
    });

    await Appointment.create({
      appointment_id: 'APT-001',
      patient_id: 'PAT-001',
      patient_name: 'Wrong Name',
      appointment_type: 'In-Person',
      scheduled_at: new Date('2026-05-01T09:00:00.000Z'),
      status: 'Confirmed',
    });

    await HealthRecord.create({
      record_id: 'REC-001',
      patient_id: 'PAT-404',
      patient_name: 'Alice Patient',
      record_type: 'Visit',
      record_date: new Date('2026-05-01T09:30:00.000Z'),
      provider: 'Dr. Test',
      save_state: 'final',
      summary: 'Follow-up',
      details: {
        visitReason: 'Follow-up',
        visitType: 'Follow-up',
        visitAssessment: 'Stable',
        appointmentId: 'APT-001',
      },
    });

    await HealthRecord.create({
      record_id: 'REC-002',
      patient_id: 'PAT-001',
      patient_name: 'Alice Patient',
      record_type: 'Prescription',
      record_date: new Date('2026-05-02T09:30:00.000Z'),
      provider: 'Dr. Test',
      save_state: 'final',
      summary: 'Prescription',
      details: {
        medicines: [
          {
            medicineId: 'MED-001',
            medicineName: 'Amoxicillin',
            prescribedDosage: '500mg',
            prescribedQuantity: 1,
            availableQuantity: 5,
            unitPrice: 10,
            totalPrice: 10,
          },
        ],
        directionsForUse: 'Take once daily',
        quantity: 1,
      },
    });

    await PrescriptionInvoice.create({
      invoice_id: 'INV-001',
      patient_id: 'PAT-404',
      patient_name: 'Wrong Name',
      health_record_id: 'REC-002',
      items: [
        {
          medicineId: 'MED-001',
          medicineName: 'Amoxicillin',
          prescribedDosage: '500mg',
          prescribedQuantity: 1,
          unitPrice: 10,
          totalPrice: 10,
        },
      ],
      total_amount: 10,
      status: 'pending',
    });
  });

  test('audit detects mismatches and proposes safe repairs', async () => {
    const report = await auditRelationships();

    expect(report.issues.patient_users_missing_patient_id).toHaveLength(1);
    expect(report.issues.appointments_patient_name_mismatch).toHaveLength(1);
    expect(report.issues.health_records_orphaned_patient).toHaveLength(1);
    expect(report.issues.prescription_invoices_orphaned_patient).toHaveLength(1);

    const repairIds = report.repair_plan.map((item) => item.id);
    expect(repairIds).toContain('user-patient-id:' + String((await User.findOne({ email: 'alice@example.com' }))._id));
    expect(repairIds).toContain('appointment-name:APT-001');
    expect(repairIds).toContain('record-orphan-patient:REC-001');
    expect(repairIds).toContain('invoice-orphan-patient:INV-001');
  });

  test('applyRepairs updates only high-confidence relationships', async () => {
    const report = await auditRelationships();
    const result = await applyRepairs(report, { apply: true });

    expect(result.applied).toBe(true);
    expect(result.applied_repairs.length).toBeGreaterThanOrEqual(4);

    const user = await User.findOne({ email: 'alice@example.com' }).lean();
    const appointment = await Appointment.findOne({ appointment_id: 'APT-001' }).lean();
    const record = await HealthRecord.findOne({ record_id: 'REC-001' }).lean();
    const invoice = await PrescriptionInvoice.findOne({ invoice_id: 'INV-001' }).lean();
    const patient = await Patient.findOne({ patient_id: 'PAT-001' }).lean();

    expect(user.patient_id).toBe('PAT-001');
    expect(appointment.patient_name).toBe('Alice Patient');
    expect(record.patient_id).toBe('PAT-001');
    expect(record.patient_name).toBe('Alice Patient');
    expect(invoice.patient_id).toBe('PAT-001');
    expect(invoice.patient_name).toBe('Alice Patient');
    expect(patient.appointment_refs).toContain('APT-001');
    expect(patient.billing_refs).toContain('INV-001');
    expect(patient.medical_history_ref).toBe('REC-001');
  });
});
