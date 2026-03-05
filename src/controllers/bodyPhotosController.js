/**
 * Body photos controller – front/side photo sets (Phase 1 stubs).
 * Protected: requires valid JWT. Optional per check-in.
 */

export const create = async (req, res) => {
  res.status(501).json({
    message: 'Not implemented',
    endpoint: 'POST /api/body-photos',
    hint: 'Create photo set. Body: frontImageUrl, sideImageUrl, optional bodyDetails id, recordedAt.',
  });
};

export const list = async (req, res) => {
  res.status(501).json({
    message: 'Not implemented',
    endpoint: 'GET /api/body-photos',
    hint: 'List photo sets for user.',
  });
};
