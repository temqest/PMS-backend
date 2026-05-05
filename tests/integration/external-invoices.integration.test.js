const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../../src/app');
const ApiKey = require('../../src/api/v1/api-keys/apiKey.model');
const PrescriptionInvoice = require('../../src/api/v1/prescription-invoices/prescriptionInvoice.model');

describe('External invoice status updates', () => {
  let mongoServer;
  const apiKeyValue = 'sk_live_test_write_invoice_key_1234567890';

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
      name: 'Test partner',
      keyHash: ApiKey.hashApiKey(apiKeyValue),
      prefix: apiKeyValue.slice(0, 8),
      description: 'Integration test key',
      status: 'active',
      permissions: ['read:invoices', 'write:invoices'],
      created_by: 'test-admin',
    });

    await PrescriptionInvoice.create({
      invoice_id: 'INV-2e-moqykdfp',
      patient_id: 'PAT-001',
      patient_name: 'Test Patient',
      health_record_id: 'HR-001',
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
      created_by: 'test-admin',
    });
  });

  test('PATCH /api/v1/external/invoices/:id updates status', async () => {
    const res = await request(app)
      .patch('/api/v1/external/invoices/INV-2e-moqykdfp')
      .set('x-api-key', apiKeyValue)
      .send({ status: 'paid' })
      .expect(200);

    expect(res.body.data.invoice.invoice_id).toBe('INV-2e-moqykdfp');
    expect(res.body.data.invoice.status).toBe('paid');

    const stored = await PrescriptionInvoice.findOne({ invoice_id: 'INV-2e-moqykdfp' });
    expect(stored.status).toBe('paid');
  });

  test('PATCH rejects missing write permission', async () => {
    await ApiKey.deleteMany({});

    await ApiKey.create({
      name: 'Read only partner',
      keyHash: ApiKey.hashApiKey(apiKeyValue),
      prefix: apiKeyValue.slice(0, 8),
      description: 'Read only test key',
      status: 'active',
      permissions: ['read:invoices'],
      created_by: 'test-admin',
    });

    const res = await request(app)
      .patch('/api/v1/external/invoices/INV-2e-moqykdfp')
      .set('x-api-key', apiKeyValue)
      .send({ status: 'paid' })
      .expect(403);

    expect(res.body.message).toMatch(/permission/i);
  });
});