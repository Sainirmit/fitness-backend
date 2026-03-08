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
      message: 'Authorization header missing or malformed. Expected: Bearer <token>',
    });
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    return res.status(401).json({ message: 'Access token is invalid or has expired.' });
  }

  const user = await User.findById(decoded.sub);
  if (!user) {
    return res.status(401).json({ message: 'User belonging to this token no longer exists.' });
  }

  req.user = user;
  next();
};
