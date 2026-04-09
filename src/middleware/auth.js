import { verifyToken } from '../utils/jwt.js';
import User from '../models/User.js';

/**
 * JWT auth guard. Attaches the full User document to req.user.
 * Usage: router.get('/me', protect, controller)
 *
 * Expects header:  Authorization: Bearer <accessToken>
 */
export const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Authorization header missing or malformed. Expected: Bearer <token>',
      retryable: false,
    });
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    return res.status(401).json({
      code: 'TOKEN_EXPIRED',
      message: 'Access token is invalid or has expired.',
      retryable: false,
    });
  }

  const user = await User.findById(decoded.sub);
  if (!user) {
    return res.status(401).json({
      code: 'USER_NOT_FOUND',
      message: 'User belonging to this token no longer exists.',
      retryable: false,
    });
  }

  req.user = user;
  next();
};
