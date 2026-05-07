const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const User = require('../api/v1/auth/user.model');

exports.protect = asyncHandler(async (req, res, next) => {
  let token;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer')) token = auth.split(' ')[1];

  if (!token) throw new AppError('No token provided. Unauthorized.', 401);

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded?.sub && mongoose.Types.ObjectId.isValid(String(decoded.sub))) {
    const user = await User.findById(decoded.sub).select('is_active');
    if (user && !user.is_active) {
      throw new AppError('Account is not active. Unauthorized.', 401);
    }
  }
  req.user = decoded;
  next();
});
