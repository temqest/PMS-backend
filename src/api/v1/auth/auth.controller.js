const asyncHandler = require('../../../utils/asyncHandler');
const authService = require('./auth.service');
const AppError = require('../../../utils/AppError');
const apiResponse = require('../../../utils/apiResponse');

exports.login = asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw new AppError('username and password are required', 400);

  const user = await authService.authenticate(username, password);
  if (!user) throw new AppError('Invalid credentials', 401);

  const token = authService.generateToken(user);
  apiResponse.success(res, 200, { token });
});

exports.register = asyncHandler(async (req, res) => {
  const {
    email,
    password,
    fullName,
    first_name,
    last_name,
    date_of_birth,
    gender,
    contact_number,
    address,
    national_id,
  } = req.body || {};
  if (!email || !password) throw new AppError('email and password are required', 400);

  const existing = await authService.findByEmail(email);
  if (existing) throw new AppError('User already exists', 409);

  const user = await authService.register({
    email,
    password,
    fullName,
    first_name,
    last_name,
    date_of_birth,
    gender,
    contact_number,
    address,
    national_id,
  });

  const token = authService.generateToken(user);
  apiResponse.success(res, 201, { token, user: { id: user.id, email: user.username, fullName: user.fullName, role: user.role, patient_id: user.patient_id, is_active: user.is_active } });
});

exports.getPendingUsers = asyncHandler(async (req, res) => {
  const users = await authService.getPendingUsers();
  apiResponse.success(res, 200, { users });
});

exports.getAllUsers = asyncHandler(async (req, res) => {
  const users = await authService.getAllUsers();
  apiResponse.success(res, 200, { users });
});

exports.activateUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!userId) throw new AppError('userId is required', 400);

  const user = await authService.activateUser(userId);
  apiResponse.success(res, 200, { user, message: 'User account activated successfully' });
});

exports.deactivateUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!userId) throw new AppError('userId is required', 400);

  const user = await authService.deactivateUser(userId);
  apiResponse.success(res, 200, { user, message: 'User account deactivated successfully' });
});

exports.getMe = asyncHandler(async (req, res) => {
  const userId = req.user?.sub;
  if (!userId) throw new AppError('Unauthorized', 401);

  const user = await authService.getCurrentUserById(String(userId));
  if (!user) throw new AppError('User not found', 404);

  apiResponse.success(res, 200, { user });
});
