/**
 * Auth controller – Google/Apple sign-in (Phase 1 stubs).
 * Phase 2: verify provider token, find-or-create user, issue JWT.
 */

export const googleLogin = async (req, res) => {
  res.status(501).json({
    message: 'Not implemented',
    endpoint: 'POST /api/auth/google',
    hint: 'Expects body: { idToken }. Will verify with Google, find-or-create user, return { user, accessToken }.',
  });
};

export const appleLogin = async (req, res) => {
  res.status(501).json({
    message: 'Not implemented',
    endpoint: 'POST /api/auth/apple',
    hint: 'Expects body: { idToken, user? }. Will verify with Apple, find-or-create user, return { user, accessToken }.',
  });
};
