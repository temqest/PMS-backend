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
  const { email, password, fullName } = req.body || {};
  if (!email || !password) throw new AppError('email and password are required', 400);

  const existing = await authService.findByEmail(email);
  if (existing) throw new AppError('User already exists', 409);

  const user = await authService.register({ email, password, fullName });

  const token = authService.generateToken(user);
  apiResponse.success(res, 201, { token, user: { id: user.id, email: user.username, fullName: user.fullName } });
});
