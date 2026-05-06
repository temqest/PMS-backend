describe('prescription inventory auth forwarding', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.PRESCRIPTION_API_URL = 'https://inventory.example.com/api/inventory';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('uses x-api-key when PRESCRIPTION_API_KEY is configured', async () => {
    process.env.PRESCRIPTION_API_KEY = 'test_api_key_123';
    delete process.env.PRESCRIPTION_API_BEARER_TOKEN;

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        { id: 'MED-1', name: 'Amoxicillin', dosage: '500mg', quantity: 10, price: 12.5, status: 'IN STOCK' },
      ]),
    });

    const service = require('../src/api/v1/health-records/healthRecord.service');
    const medicines = await service.getPrescriptionMedicines();

    expect(medicines).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://inventory.example.com/api/inventory',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
          'x-api-key': 'test_api_key_123',
        }),
      })
    );
  });

  test('uses bearer token when PRESCRIPTION_API_BEARER_TOKEN is configured', async () => {
    delete process.env.PRESCRIPTION_API_KEY;
    process.env.PRESCRIPTION_API_BEARER_TOKEN = 'token_abc_456';

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'MED-2', name: 'Ibuprofen', dosage: '200mg', quantity: 20, price: 6.25, status: 'IN STOCK' },
        ],
      }),
    });

    const service = require('../src/api/v1/health-records/healthRecord.service');
    const medicines = await service.getPrescriptionMedicines();

    expect(medicines).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://inventory.example.com/api/inventory',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer token_abc_456',
        }),
      })
    );
  });

  test('fails fast when inventory auth is missing', async () => {
    delete process.env.PRESCRIPTION_API_KEY;
    delete process.env.PRESCRIPTION_API_BEARER_TOKEN;
    global.fetch = jest.fn();
    const logger = require('../src/utils/logger');
    const loggerSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    const service = require('../src/api/v1/health-records/healthRecord.service');

    await expect(service.getPrescriptionMedicines()).rejects.toMatchObject({
      message: 'Prescription inventory authentication is not configured.',
      statusCode: 500,
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'PRESCRIPTION_INVENTORY_AUTH_MISSING',
      })
    );
  });
});
