jest.mock('axios', () => ({
  post: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}));

const axios = require('axios');
const auditService = require('../src/api/v1/audit-logs/auditLog.service');

describe('external audit log posting', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      AUDIT_LOG_API_URL: 'https://admin.example.test/audit-logs',
      SUBSYSTEM_API_KEY: 'subsystem-key',
      AUDIT_LOG_TIMEOUT_MS: '2500',
      AUDIT_LOG_RETRY_COUNT: '0',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('posts sanitized audit payload with subsystem key header', async () => {
    axios.post.mockResolvedValue({ status: 201, data: { ok: true } });

    const payload = {
      user_id: 'user-1',
      action_type: 'RECORD_CREATED',
      details: 'Created health record.',
      ip_addr: '127.0.0.1',
      subsystem: 'Health Record',
    };

    const result = await auditService.sendAuditLog(payload);

    expect(result).toEqual({ sent: true, status: 201 });
    expect(axios.post).toHaveBeenCalledWith(
      'https://admin.example.test/audit-logs',
      payload,
      expect.objectContaining({
        timeout: 2500,
        headers: {
          'Content-Type': 'application/json',
          'X-Subsystem-Key': 'subsystem-key',
        },
      })
    );
  });

  test('returns failure result instead of throwing when admin audit API fails', async () => {
    axios.post.mockRejectedValue(new Error('network down'));

    await expect(auditService.sendAuditLog({
      user_id: 'user-1',
      action_type: 'APPOINTMENT_CREATED',
      details: 'Appointment created.',
      ip_addr: '127.0.0.1',
      subsystem: 'Appointment',
    })).resolves.toMatchObject({
      sent: false,
      error: 'network down',
    });
  });
});
