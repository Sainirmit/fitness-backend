/**
 * User controller – profile and onboarding (Phase 1 stubs).
 * Protected: requires valid JWT (Phase 2/3).
 */

export const getMe = async (req, res) => {
  res.status(501).json({
    message: 'Not implemented',
    endpoint: 'GET /api/users/me',
    hint: 'Returns current user profile from req.user.',
  });
};

export const updateMe = async (req, res) => {
  res.status(501).json({
    message: 'Not implemented',
    endpoint: 'PATCH /api/users/me',
    hint: 'Updates onboarding/profile: name, fitnessGoals, fitnessLevel, motivations, workout/diet prefs.',
  });
};
