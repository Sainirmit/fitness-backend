import jwt from 'jsonwebtoken';

const secret = () => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not set in environment variables.');
  }
  return process.env.JWT_SECRET;
};

const expiresIn = () => process.env.JWT_EXPIRES_IN || '7d';

/**
 * Signs a JWT with the given payload.
 * @param {object} payload – data to encode (avoid sensitive fields)
 * @returns {string} signed JWT
 */
export const signToken = (payload) => jwt.sign(payload, secret(), { expiresIn: expiresIn() });

/**
 * Verifies and decodes a JWT.
 * Throws if the token is invalid or expired.
 * @param {string} token
 * @returns {object} decoded payload
 */
export const verifyToken = (token) => jwt.verify(token, secret());
