/**
 * Body details controller – body snapshots (Phase 1 stubs).
 * Protected: requires valid JWT. Weight in kg, height in cm; store display units.
 */

export const create = async (req, res) => {
  res.status(501).json({
    message: 'Not implemented',
    endpoint: 'POST /api/body-details',
    hint: 'Create body snapshot. Body: gender, age, weight, weightUnit, height, heightUnit. Convert to kg/cm; store display units.',
  });
};

export const list = async (req, res) => {
  res.status(501).json({
    message: 'Not implemented',
    endpoint: 'GET /api/body-details',
    hint: 'List body details for user. Query: ?latest=true for current snapshot.',
  });
};
