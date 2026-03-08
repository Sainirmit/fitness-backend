import { getFirebaseAdmin } from '../config/firebase.js';
import { signToken } from '../utils/jwt.js';
import User from '../models/User.js';

/**
 * POST /api/auth/google
 *
 * Payload (from frontend):
 *   { "idToken": "<Firebase ID token obtained after Google Sign-In on the client>" }
 *
 * Flow:
 *   1. Verify the Firebase ID token via Firebase Admin SDK.
 *   2. Find or create a User record keyed on { email, provider: "google" }.
 *   3. Issue a signed JWT (HS256) for all subsequent API calls.
 *
 * Response 200:
 *   { accessToken, isNewUser, user }
 *
 * Response 400: missing / malformed body
 * Response 401: Firebase token invalid or expired
 */
export const googleLogin = async (req, res) => {
  const { idToken } = req.body;

  if (!idToken || typeof idToken !== 'string') {
    return res.status(400).json({ message: 'idToken (string) is required in the request body.' });
  }

  // --- 1. Verify Firebase ID token ---
  let decoded;
  try {
    const firebaseAdmin = getFirebaseAdmin();
    decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
  } catch (err) {
    console.error('[googleLogin] Firebase token verification failed:', err.message);
    return res.status(401).json({ message: 'Google token is invalid or has expired.' });
  }

  const { uid, email, name: googleName } = decoded;

  if (!email) {
    return res.status(400).json({ message: 'Google account must have a verified email address.' });
  }

  // --- 2. Find or create user ---
  let isNewUser = false;
  let user = await User.findOne({ email, provider: 'google' });

  if (!user) {
    isNewUser = true;
    user = await User.create({
      email,
      provider: 'google',
      providerId: uid,
      name: googleName || '',
    });
  } else if (user.providerId !== uid) {
    // Keep providerId in sync in case Firebase rotates it (rare)
    user.providerId = uid;
    await user.save();
  }

  // --- 3. Issue JWT ---
  const accessToken = signToken({
    sub: user._id.toString(),
    email: user.email,
    provider: 'google',
  });

  return res.status(200).json({ accessToken, isNewUser, user });
};

/**
 * POST /api/auth/apple  –  stub, coming soon.
 */
export const appleLogin = async (req, res) => {
  res.status(501).json({
    message: 'Not implemented',
    endpoint: 'POST /api/auth/apple',
    hint: 'Expects body: { idToken, user? }. Will verify with Apple, find-or-create user, return { accessToken, isNewUser, user }.',
  });
};
