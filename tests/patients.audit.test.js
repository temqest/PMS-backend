const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let app;
let mongoServer;

const AuditLog = require('../src/api/v1/audit-logs/auditLog.model');
const User = require('../src/api/v1/auth/user.model');
const Patient = require('../src/api/v1/patients/patient.model');
const Appointment = require('../src/api/v1/appointments/appointment.model');
const PrescriptionInvoice = require('../src/api/v1/prescription-invoices/prescriptionInvoice.model');
const ApiKey = require('../src/api/v1/api-keys/apiKey.model');
const auditService = require('../src/api/v1/audit-logs/auditLog.service');

const tokenFor = (payload) => jwt.sign(payload, process.env.JWT_SECRET);

const samplePatient = {
  first_name: 'Audit',
  last_name: 'Patient',
  date_of_birth: '1990-01-01',
  gender: 'Other',
  contact_number: '555-9000',
  email_address: 'audit.patient@example.com',
  address: '123 Audit Lane',
};

const createPatientDirect = async (overrides = {}) => Patient.create({
  patient_id: overrides.patient_id || 'PAT-AUDIT-001',
  first_name: overrides.first_name || 'Audit',
  last_name: overrides.last_name || 'Patient',
  date_of_birth: new Date('1990-01-01'),
  gender: 'Other',
  contact_number: overrides.contact_number || '555-9001',
  email_address: overrides.email_address || 'audit.direct@example.com',
  address: '123 Audit Lane',
  created_by: 'test',
});

describe('durable audit logging', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    process.env.JWT_SECRET = 'testsecret';
    process.env.NODE_ENV = 'test';
    delete process.env.AUDIT_LOG_API_URL;
    delete process.env.ADMIN_SYSTEM_URL;
    await mongoose.connect(process.env.MONGO_URI);
    app = require('../src/app');
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
  });

  test('sanitizes secrets before storing audit values', async () => {
    const log = await auditService.logAuditEvent({
      actor: { id: 'admin-1', role: 'system_admin', name: 'Admin One' },
      action: 'UPDATE_API_KEY',
      entity_type: 'api_key',
      entity_id: 'key-1',
      old_value: { password: 'secret', nested: { token: 'jwt', safe: 'visible' } },
      new_value: { apiKey: 'sk_live_hidden', keyHash: 'hash', name: 'Visible key' },
    });

    expect(log.toObject()).toMatchObject({
      user_id: 'admin-1',
      action_type: 'UPDATE_API_KEY',
      subsystem: 'API Key',
    });
    expect(log.details).toContain('[redacted]');
    expect(log.details).toContain('Visible key');
    expect(log.details).not.toContain('secret');
    expect(log.details).not.toContain('sk_live_hidden');
    expect(log.details).not.toContain('hash');
  });

  test('audit log endpoints are admin/front desk only and support filters', async () => {
    await AuditLog.create([
      {
        user_id: 'admin-1',
        action_type: 'VIEW_PATIENT',
        subsystem: 'Patient',
        details: 'Patient profile viewed.',
      },
      {
        user_id: 'front-1',
        action_type: 'CREATE_APPOINTMENT',
        subsystem: 'Appointment',
        details: 'Appointment created.',
      },
    ]);

    await request(app).get('/api/v1/audit-logs').expect(401);

    await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${tokenFor({ sub: 'patient-1', role: 'patient' })}`)
      .expect(403);

    await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${tokenFor({ sub: 'physician-1', role: 'physician' })}`)
      .expect(403);

    const deniedLogs = await AuditLog.find({ action_type: 'UNAUTHORIZED_ACCESS' }).lean();
    expect(deniedLogs.length).toBeGreaterThanOrEqual(3);

    const frontDeskRes = await request(app)
      .get('/api/v1/audit-logs?action_type=VIEW_PATIENT&limit=1')
      .set('Authorization', `Bearer ${tokenFor({ sub: 'front-1', role: 'front_desk' })}`)
      .expect(200);

    expect(frontDeskRes.body.data.audit_logs).toHaveLength(1);
    expect(frontDeskRes.body.data.audit_logs[0].action_type).toBe('VIEW_PATIENT');
    expect(frontDeskRes.body.data.audit_logs[0]).toHaveProperty('user_id');
    expect(frontDeskRes.body.data.audit_logs[0]).toHaveProperty('details');
    expect(frontDeskRes.body.data.audit_logs[0]).toHaveProperty('ip_addr');
    expect(frontDeskRes.body.data.audit_logs[0]).toHaveProperty('subsystem');
    expect(frontDeskRes.body.data.audit_logs[0]).not.toHaveProperty('actor_user_id');
    expect(frontDeskRes.body.data.audit_logs[0]).not.toHaveProperty('entity_type');
    expect(frontDeskRes.body.pagination.total).toBe(1);

    const detailId = frontDeskRes.body.data.audit_logs[0]._id;
    const detailRes = await request(app)
      .get(`/api/v1/audit-logs/${detailId}`)
      .set('Authorization', `Bearer ${tokenFor({ sub: 'admin-1', role: 'system_admin' })}`)
      .expect(200);

    expect(detailRes.body.data.audit_log._id).toBe(detailId);
  });

  test('patient, appointment, and health record actions create audit logs', async () => {
    const adminToken = tokenFor({ sub: 'admin-1', role: 'system_admin', fullName: 'Audit Admin' });

    const createPatient = await request(app)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(samplePatient)
      .expect(201);

    const patientId = createPatient.body.data.patient.patient_id;

    await request(app)
      .get(`/api/v1/patients/${patientId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app)
      .patch(`/api/v1/patients/${patientId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ contact_number: '555-9999' })
      .expect(200);

    const createAppointment = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        patient_id: patientId,
        appointment_type: 'In-Person',
        date: '2026-05-10',
        time: '09:30',
        reason: 'Audit follow-up',
      })
      .expect(201);

    const appointmentId = createAppointment.body.data.appointment.appointment_id;

    await request(app)
      .patch(`/api/v1/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ priority: 'Urgent' })
      .expect(200);

    await request(app)
      .patch(`/api/v1/appointments/${appointmentId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Audit cancellation' })
      .expect(200);

    const createRecord = await request(app)
      .post('/api/v1/health-records')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        patient_id: patientId,
        patient_name: 'Audit Patient',
        record_type: 'Visit',
        record_date: '2026-05-10',
        provider: 'Dr. Audit',
        summary: 'Audit visit',
        details: {
          visitReason: 'Audit',
          visitType: 'Consultation',
          visitAssessment: 'Stable',
        },
      })
      .expect(201);

    const recordId = createRecord.body.data.record.record_id;

    await request(app)
      .get(`/api/v1/health-records/${recordId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app)
      .patch(`/api/v1/health-records/${recordId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ summary: 'Updated audit visit' })
      .expect(200);

    await request(app)
      .delete(`/api/v1/health-records/${recordId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app)
      .delete(`/api/v1/patients/${patientId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const actions = (await AuditLog.find({}).lean()).map((log) => log.action_type);
    expect(actions).toEqual(expect.arrayContaining([
      'CREATE_PATIENT',
      'VIEW_PATIENT',
      'UPDATE_PATIENT',
      'DELETE_PATIENT',
      'CREATE_APPOINTMENT',
      'UPDATE_APPOINTMENT',
      'CANCEL_APPOINTMENT',
      'CREATE_HEALTH_RECORD',
      'VIEW_HEALTH_RECORD',
      'UPDATE_HEALTH_RECORD',
      'DELETE_HEALTH_RECORD',
    ]));
  });

  test('auth, telehealth, and API key lifecycle actions create audit logs without raw secrets', async () => {
    const password = 'AuditPassword!123';
    const user = await User.create({
      email: 'admin.audit@example.com',
      password_hash: bcrypt.hashSync(password, 8),
      role: 'system_admin',
      fullName: 'Audit Admin',
      is_active: true,
    });

    await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin.audit@example.com', password: 'wrong' })
      .expect(401);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin.audit@example.com', password })
      .expect(200);

    const adminToken = loginRes.body.data.token;

    const patient = await createPatientDirect({ patient_id: 'PAT-TEL-001' });
    const appointment = await Appointment.create({
      appointment_id: 'APT-TEL-001',
      patient_id: patient.patient_id,
      patient_name: 'Audit Patient',
      appointment_type: 'Telehealth',
      scheduled_at: new Date('2026-05-10T09:30:00.000Z'),
      status: 'Confirmed',
    });

    await request(app)
      .post('/api/v1/audit-logs/events/telehealth')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action_type: 'START_TELEHEALTH_CALL', appointment_id: appointment.appointment_id })
      .expect(201);

    const createKeyRes = await request(app)
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Audit integration key', permissions: ['read:invoices'] })
      .expect(201);

    const apiKeyId = createKeyRes.body.data.id;
    expect(createKeyRes.body.data.apiKey).toMatch(/^sk_live_/);

    await request(app)
      .patch(`/api/v1/api-keys/${apiKeyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: 'Updated description' })
      .expect(200);

    await request(app)
      .patch(`/api/v1/api-keys/${apiKeyId}/rotate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Rotated audit integration key' })
      .expect(200);

    await request(app)
      .patch(`/api/v1/api-keys/${apiKeyId}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app)
      .delete(`/api/v1/api-keys/${apiKeyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const logs = await AuditLog.find({}).lean();
    const actions = logs.map((log) => log.action_type);
    expect(actions).toEqual(expect.arrayContaining([
      'LOGIN_FAILED',
      'LOGIN_SUCCESS',
      'TELEHEALTH_STARTED',
      'CREATE_API_KEY',
      'UPDATE_API_KEY',
      'ROTATE_API_KEY',
      'REVOKE_API_KEY',
      'DELETE_API_KEY',
      'LOGOUT',
    ]));

    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain(password);
    expect(serializedLogs).not.toContain(createKeyRes.body.data.apiKey);
    expect(String(user._id)).toBeTruthy();
  });

  test('patient login mode uses the local patient account store only', async () => {
    const password = 'PatientPassword!123';
    await User.create({
      email: 'portal.patient@example.com',
      password_hash: bcrypt.hashSync(password, 8),
      role: 'patient',
      fullName: 'Portal Patient',
      patient_id: 'PAT-PORTAL-001',
      is_active: true,
    });

    await User.create({
      email: 'staff.local@example.com',
      password_hash: bcrypt.hashSync(password, 8),
      role: 'system_admin',
      fullName: 'Local Staff',
      is_active: true,
    });

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'portal.patient@example.com', password, auth_type: 'patient' })
      .expect(200);

    expect(loginRes.body.data.user).toMatchObject({
      id: expect.any(String),
      user_id: expect.any(String),
      username: 'portal.patient@example.com',
      role: 'patient',
      status: 'active',
      authType: 'patient',
    });

    const decoded = jwt.verify(loginRes.body.data.accessToken, process.env.JWT_SECRET);
    expect(decoded).toMatchObject({
      username: 'portal.patient@example.com',
      role: 'patient',
      patient_id: 'PAT-PORTAL-001',
    });

    await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'staff.local@example.com', password, auth_type: 'patient' })
      .expect(401);
  });

  test('auth context supports local users and external admin subsystem users', async () => {
    const localUser = await User.create({
      email: 'portal.context@example.com',
      password_hash: bcrypt.hashSync('ContextPassword!123', 8),
      role: 'patient',
      fullName: 'Context Patient',
      patient_id: 'PAT-CONTEXT-001',
      is_active: true,
    });

    const localRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenFor({ sub: String(localUser._id), role: 'patient' })}`)
      .expect(200);

    expect(localRes.body.data.user).toMatchObject({
      id: String(localUser._id),
      user_id: String(localUser._id),
      username: 'portal.context@example.com',
      role: 'patient',
      status: 'active',
      authType: 'patient',
      patient_id: 'PAT-CONTEXT-001',
    });

    const externalToken = tokenFor({
      sub: 'external-admin-user-1',
      user_id: 'external-admin-user-1',
      username: 'dr.context',
      role: 'physician',
      subsystem: 'Patient',
      status: 'active',
    });

    const externalRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${externalToken}`)
      .expect(200);

    expect(externalRes.body.data.user).toEqual({
      id: 'external-admin-user-1',
      user_id: 'external-admin-user-1',
      username: 'dr.context',
      role: 'physician',
      subsystem: 'Patient',
      status: 'active',
      authType: 'admin',
      permissions: [
        'dashboard:view',
        'patients:view',
        'patients:create',
        'patients:update',
        'appointments:view',
        'appointments:create',
        'appointments:update',
        'health_records:view',
        'health_records:create',
        'health_records:update',
        'prescriptions:view',
        'prescriptions:create',
        'telehealth:view',
        'telehealth:start',
      ],
      services: {
        dashboard: true,
        patients: true,
        appointments: true,
        health_records: true,
        prescriptions: true,
        telehealth: true,
      },
    });

    const objectIdLikeExternalId = new mongoose.Types.ObjectId().toString();
    const objectIdLikeExternalRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenFor({
        sub: objectIdLikeExternalId,
        user_id: objectIdLikeExternalId,
        username: 'admin.objectid',
        role: 'system_admin',
        subsystem: 'Patient',
        status: 'active',
      })}`)
      .expect(200);

    expect(objectIdLikeExternalRes.body.data.user).toEqual({
      id: objectIdLikeExternalId,
      user_id: objectIdLikeExternalId,
      username: 'admin.objectid',
      role: 'system_admin',
      subsystem: 'Patient',
      status: 'active',
      authType: 'admin',
      permissions: [
        'dashboard:view',
        'patients:view',
        'patients:create',
        'patients:update',
        'patients:delete',
        'appointments:view',
        'appointments:create',
        'appointments:update',
        'health_records:view',
        'health_records:create',
        'health_records:update',
        'health_records:delete',
        'prescriptions:view',
        'prescriptions:create',
        'prescriptions:update',
        'telehealth:view',
        'telehealth:start',
        'admin_users:view',
        'admin_users:manage',
        'audit_logs:view',
      ],
      services: {
        dashboard: true,
        patients: true,
        appointments: true,
        health_records: true,
        prescriptions: true,
        telehealth: true,
        admin_users: true,
        audit_logs: true,
      },
    });

    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenFor({
        sub: 'inactive-external-user-1',
        user_id: 'inactive-external-user-1',
        username: 'inactive.context',
        role: 'front_desk',
        subsystem: 'Patient',
        status: 'inactive',
      })}`)
      .expect(401);
  });

  test('prescription invoice status updates are audited for API-key actors', async () => {
    const patient = await createPatientDirect({ patient_id: 'PAT-INV-001', contact_number: '555-9101' });
    const invoice = await PrescriptionInvoice.create({
      invoice_id: 'INV-AUDIT-001',
      patient_id: patient.patient_id,
      patient_name: 'Audit Patient',
      items: [{
        medicineId: 'MED-1',
        medicineName: 'Audit Med',
        prescribedDosage: '10mg',
        prescribedQuantity: 1,
        unitPrice: 10,
        totalPrice: 10,
      }],
      total_amount: 10,
      status: 'pending',
      created_by: 'admin-1',
    });

    const rawApiKey = 'sk_live_audit_external_key_123456789';
    await ApiKey.create({
      name: 'External writer',
      keyHash: ApiKey.hashApiKey(rawApiKey),
      prefix: rawApiKey.slice(0, 14),
      permissions: ['write:invoices'],
      status: 'active',
      created_by: 'admin-1',
    });

    await request(app)
      .patch(`/api/v1/external/invoices/${invoice.invoice_id}`)
      .set('x-api-key', rawApiKey)
      .send({ status: 'paid', is_released: true })
      .expect(200);

    const log = await AuditLog.findOne({ action_type: 'UPDATE_PRESCRIPTION_INVOICE_STATUS' }).lean();
    expect(log).toBeTruthy();
    expect(log.user_id).toBe('admin-1');
    expect(log.subsystem).toBe('Prescription Invoice');
    expect(log.details).toContain(invoice.invoice_id);
    expect(JSON.stringify(log)).not.toContain(rawApiKey);
  });
});
