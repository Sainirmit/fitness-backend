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
 * POST /api/auth/apple
 *
 * Payload (from frontend):
 *   { 
 *     "idToken": "<Firebase ID token obtained after Apple Sign-In on the client>",
 *     "user": { "name": { "firstName": "...", "lastName": "..." } } // Optional, only on first sign-in
 *   }
 *
 * Flow:
 *   1. Verify the Firebase ID token via Firebase Admin SDK.
 *   2. Find or create a User record keyed on { email, provider: "apple" }.
 *   3. Issue a signed JWT (HS256) for all subsequent API calls.
 *
 * Response 200:
 *   { accessToken, isNewUser, user }
 *
 * Response 400: missing / malformed body
 * Response 401: Firebase token invalid or expired
 */
export const appleLogin = async (req, res) => {
  const { idToken, user: appleUserInfo } = req.body;

  if (!idToken || typeof idToken !== 'string') {
    return res.status(400).json({ message: 'idToken (string) is required in the request body.' });
  }

  // --- 1. Verify Firebase ID token ---
  let decoded;
  try {
    const firebaseAdmin = getFirebaseAdmin();
    decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
  } catch (err) {
    console.error('[appleLogin] Firebase token verification failed:', err.message);
    return res.status(401).json({ message: 'Apple token is invalid or has expired.' });
  }

  const { uid, email } = decoded;

  if (!email) {
    return res.status(400).json({ message: 'Apple account must have a verified email address.' });
  }

  // --- 2. Find or create user ---
  let isNewUser = false;
  let user = await User.findOne({ email, provider: 'apple' });

  if (!user) {
    isNewUser = true;
    
    // Extract name from Apple user info (only provided on first sign-in)
    let fullName = '';
    if (appleUserInfo?.name) {
      const { firstName, lastName } = appleUserInfo.name;
      fullName = `${firstName || ''} ${lastName || ''}`.trim();
    }

    user = await User.create({
      email,
      provider: 'apple',
      providerId: uid,
      name: fullName,
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
    provider: 'apple',
  });

  return res.status(200).json({ accessToken, isNewUser, user });
};
