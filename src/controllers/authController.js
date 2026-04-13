import { getFirebaseAdmin } from '../config/firebase.js';
import { signToken } from '../utils/jwt.js';
import User from '../models/User.js';

const normalizeEmail = (email) =>
  typeof email === 'string' ? email.trim().toLowerCase() : '';
const isAppleRelayEmail = (email) =>
  typeof email === 'string' && /@privaterelay\.appleid\.com$/i.test(email.trim());

const safeDecodeJwtClaims = (token) => {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const getProviderRegex = (provider) => new RegExp(`^${provider}$`, 'i');

async function findOrCreateSocialUser({
  provider,
  uid,
  email,
  suggestedName = '',
}) {
  const normalizedEmail = normalizeEmail(email);
  let isNewUser = false;

  // 1) Prefer Firebase UID match first.
  // If Google and Apple are linked to one Firebase user, this keeps one backend account
  // even if Apple returns a private relay email.
  let user = await User.findOne({ providerId: uid });

  // 2) Fallback to normalized email (provider-agnostic) to avoid duplicate rows when
  // the same real email signs in through different providers.
  if (!user) {
    user = await User.findOne({
      email: normalizedEmail,
    });
  }

  if (!user) {
    isNewUser = true;
    user = await User.create({
      email: normalizedEmail,
      provider,
      providerId: uid,
      name: suggestedName || '',
    });
    return { user, isNewUser };
  }

  // Keep auth identity fields normalized and linked for future sign-ins.
  let shouldSave = false;
  if (!user.provider || !getProviderRegex(provider).test(user.provider)) {
    // Preserve compatibility with existing single-provider field by recording
    // the most recent provider used for login.
    user.provider = provider;
    shouldSave = true;
  }
  if (user.providerId !== uid) {
    // If this login comes from a different Firebase user ID for the same person,
    // keep providerId in sync with the latest verified identity.
    user.providerId = uid;
    shouldSave = true;
  }
  if (
    user.email !== normalizedEmail
    && normalizedEmail
    // Never replace a real email with Apple private relay.
    && (!isAppleRelayEmail(normalizedEmail) || isAppleRelayEmail(user.email))
  ) {
    user.email = normalizedEmail;
    shouldSave = true;
  }
  if ((!user.name || !user.name.trim()) && suggestedName) {
    user.name = suggestedName;
    shouldSave = true;
  }

  if (shouldSave) {
    await user.save();
  }

  return { user, isNewUser };
}

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
    const claims = safeDecodeJwtClaims(idToken);
    console.error('[googleLogin] Firebase token verification failed:', {
      message: err?.message,
      code: err?.code,
      // Helpful for debugging wrong-project vs expired vs wrong token type.
      tokenClaims: claims
        ? {
            iss: claims.iss,
            aud: claims.aud,
            exp: claims.exp,
            iat: claims.iat,
            sub: claims.sub,
            email: claims.email,
            azp: claims.azp,
          }
        : null,
    });
    return res.status(401).json({ message: 'Google token is invalid or has expired.' });
  }

  const { uid, email, name: googleName } = decoded;

  if (!email) {
    return res.status(400).json({ message: 'Google account must have a verified email address.' });
  }

  // --- 2. Find or create user ---
  const { user, isNewUser } = await findOrCreateSocialUser({
    provider: 'google',
    uid,
    email,
    suggestedName: googleName || '',
  });

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
    const claims = safeDecodeJwtClaims(idToken);
    console.error('[appleLogin] Firebase token verification failed:', {
      message: err?.message,
      code: err?.code,
      tokenClaims: claims
        ? {
            iss: claims.iss,
            aud: claims.aud,
            exp: claims.exp,
            iat: claims.iat,
            sub: claims.sub,
            email: claims.email,
            azp: claims.azp,
          }
        : null,
    });
    return res.status(401).json({ message: 'Apple token is invalid or has expired.' });
  }

  const { uid, email } = decoded;

  if (!email) {
    return res.status(400).json({ message: 'Apple account must have a verified email address.' });
  }

  // Extract name from Apple user info (only provided on first sign-in)
  let fullName = '';
  if (appleUserInfo?.name) {
    const { firstName, lastName } = appleUserInfo.name;
    fullName = `${firstName || ''} ${lastName || ''}`.trim();
  }

  // --- 2. Find or create user ---
  const { user, isNewUser } = await findOrCreateSocialUser({
    provider: 'apple',
    uid,
    email,
    suggestedName: fullName,
  });

  // --- 3. Issue JWT ---
  const accessToken = signToken({
    sub: user._id.toString(),
    email: user.email,
    provider: 'apple',
  });

  return res.status(200).json({ accessToken, isNewUser, user });
};

/**
 * POST /api/auth/logout
 *
 * Stateless JWT logout endpoint.
 * Backend does not store session state, so this confirms logout and lets clients
 * clear locally stored auth tokens/cached profile data.
 *
 * Response 200:
 *   { message: "Logged out successfully." }
 */
export const logout = async (req, res) => {
  return res.status(200).json({ message: 'Logged out successfully.' });
};
