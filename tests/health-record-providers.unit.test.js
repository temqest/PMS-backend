jest.mock('axios', () => ({
  get: jest.fn(),
}));

const axios = require('axios');
const healthRecordService = require('../src/api/v1/health-records/healthRecord.service');

describe('health record provider directory', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    healthRecordService.__private__.resetStaffProviderCache();
    process.env = {
      ...originalEnv,
      STAFF_SUBSYSTEM_URL: 'https://staff.example.test/api/staff',
      STAFF_SUBSYSTEM_API_KEY: 'staff-subsystem-secret',
      STAFF_SUBSYSTEM_TIMEOUT_MS: '1500',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('loads relevant providers from the staff subsystem and formats doctor names', async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: {
        data: [
          {
            id: 'staff-1',
            first_name: 'John',
            last_name: 'Smith',
            role: 'Doctor',
          },
          {
            id: 'staff-2',
            full_name: 'Maria Garcia',
            title: 'Dr.',
            role: 'Physician',
          },
          {
            id: 'staff-3',
            full_name: 'Casey Nurse',
            role: 'Nurse',
          },
          {
            id: 'staff-4',
            full_name: 'Front Desk User',
            role: 'Front Desk',
          },
        ],
      },
    });

    const result = await healthRecordService.getHealthRecordProviders({
      sub: 'staff-1',
      user_id: 'staff-1',
      fullName: 'John Smith',
      role: 'physician',
    });

    expect(axios.get).toHaveBeenCalledWith(
      'https://staff.example.test/api/staff',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Subsystem-Key': 'staff-subsystem-secret',
        }),
      })
    );
    expect(result.providers).toEqual([
      expect.objectContaining({ id: 'staff-3', name: 'Casey Nurse' }),
      expect.objectContaining({ id: 'staff-1', name: 'Dr. John Smith' }),
      expect.objectContaining({ id: 'staff-2', name: 'Dr. Maria Garcia' }),
    ]);
    expect(result.providers).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'staff-4' })])
    );
    expect(result.current_provider).toEqual(
      expect.objectContaining({ id: 'staff-1', name: 'Dr. John Smith' })
    );
  });

  test('falls back to the current logged-in provider when the staff subsystem fails', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));

    const result = await healthRecordService.getHealthRecordProviders({
      sub: 'staff-77',
      user_id: 'staff-77',
      fullName: 'Ana Reyes',
      role: 'physician',
    });

    expect(result.providers).toEqual([
      expect.objectContaining({ id: 'staff-77', name: 'Dr. Ana Reyes' }),
    ]);
    expect(result.current_provider).toEqual(
      expect.objectContaining({ id: 'staff-77', name: 'Dr. Ana Reyes' })
    );
    expect(result.warning).toMatch(/fallback/i);
  });
});
