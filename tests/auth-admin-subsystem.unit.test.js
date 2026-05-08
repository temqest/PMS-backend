jest.mock('axios', () => ({
  post: jest.fn(),
}));

const axios = require('axios');
const authService = require('../src/api/v1/auth/auth.service');

describe('admin subsystem authentication proxy', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      ADMIN_SYSTEM_URL: 'https://admin-subystem.onrender.com',
      SUBSYSTEM_API_KEY: 'test-subsystem-key',
      JWT_SECRET: 'test-secret',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('posts username, password, subsystem, and subsystem key to admin login', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        accessToken: 'admin-token',
        user: {
          user_id: 'b2ab4f66-d4b3-4e62-bb20-6605116ad7e6',
          username: 'dr.smith',
          role: 'Doctor',
          subsystem: 'Patient',
          status: 'active',
        },
      },
    });

    const result = await authService.authenticateWithAdminSubsystem(' dr.smith ', 'their_password');

    expect(axios.post).toHaveBeenCalledWith(
      'https://admin-subystem.onrender.com/admin/api/auth/subsystem-login',
      {
        username: 'dr.smith',
        password: 'their_password',
        subsystem: 'Patient',
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Subsystem-Key': 'test-subsystem-key',
        }),
      })
    );
    expect(result.user).toEqual({
      id: 'b2ab4f66-d4b3-4e62-bb20-6605116ad7e6',
      user_id: 'b2ab4f66-d4b3-4e62-bb20-6605116ad7e6',
      username: 'dr.smith',
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
    expect(result.adminAccessToken).toBe('admin-token');
  });

  test('rejects malformed admin subsystem responses', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { accessToken: 'admin-token', user: { username: 'dr.smith' } },
    });

    await expect(authService.authenticateWithAdminSubsystem('dr.smith', 'secret')).rejects.toMatchObject({
      statusCode: 502,
      message: 'Admin subsystem returned an invalid login response.',
    });
  });

  test('accepts wrapped admin responses and normalizes staff role', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        data: {
          token: 'admin-token',
          user: {
            user_id: 'staff-123',
            username: 'frontdesk',
            role: 'Staff',
            subsystem: 'Patient',
            status: 'ACTIVE',
          },
        },
      },
    });

    const result = await authService.authenticateWithAdminSubsystem('frontdesk', 'their_password');

    expect(result.user).toEqual({
      id: 'staff-123',
      user_id: 'staff-123',
      username: 'frontdesk',
      role: 'front_desk',
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
        'telehealth:view',
        'audit_logs:view',
      ],
      services: {
        dashboard: true,
        patients: true,
        appointments: true,
        telehealth: true,
        audit_logs: true,
      },
    });
  });

  test('maps admin role to broad local permissions', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        accessToken: 'admin-broad-token',
        user: {
          user_id: 'admin-123',
          username: 'sys.admin',
          role: 'Admin',
          subsystem: 'Patient',
          status: 'active',
        },
      },
    });

    const result = await authService.authenticateWithAdminSubsystem('sys.admin', 'their_password');

    expect(result.user.role).toBe('system_admin');
    expect(result.user.permissions).toEqual(expect.arrayContaining([
      'dashboard:view',
      'patients:view',
      'patients:create',
      'patients:update',
      'patients:delete',
      'appointments:view',
      'health_records:view',
      'prescriptions:view',
      'telehealth:start',
      'admin_users:view',
      'admin_users:manage',
      'audit_logs:view',
    ]));
    expect(result.user.services).toMatchObject({
      dashboard: true,
      patients: true,
      appointments: true,
      health_records: true,
      prescriptions: true,
      telehealth: true,
      admin_users: true,
      audit_logs: true,
    });
  });

  test('normalizes subsystem-prefixed admin roles from the admin subsystem', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        accessToken: 'admin-prefixed-token',
        user: {
          user_id: 'prefixed-admin-123',
          username: 'pm.admin',
          role: 'patient_management:_admin',
          subsystem: 'Patient',
          status: 'active',
        },
      },
    });

    const result = await authService.authenticateWithAdminSubsystem('pm.admin', 'their_password');

    expect(result.user).toMatchObject({
      id: 'prefixed-admin-123',
      user_id: 'prefixed-admin-123',
      username: 'pm.admin',
      role: 'system_admin',
      authType: 'admin',
      status: 'active',
    });
    expect(result.user.permissions).toEqual(expect.arrayContaining([
      'dashboard:view',
      'admin_users:view',
      'admin_users:manage',
      'audit_logs:view',
    ]));
  });
});
