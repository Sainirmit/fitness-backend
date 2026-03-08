import BodyDetails from '../models/BodyDetails.js';

const lbsToKg = (lbs) => Math.round(lbs * 0.453592 * 10) / 10;
const inchesToCm = (inches) => Math.round(inches * 2.54 * 10) / 10;

/**
 * POST /api/body-details
 *
 * Standalone endpoint for adding a new body-metrics snapshot (e.g. weekly check-in).
 * During onboarding, body details are created automatically by PATCH /api/users/me —
 * no need to call this endpoint separately.
 *
 * Payload:
 *   {
 *     "gender":     "male",
 *     "age":        28,
 *     "weight":     180,          ← in weightUnit
 *     "weightUnit": "lbs",        ← "kg" | "lbs"  (stored as kg)
 *     "height":     71,           ← in heightUnit (total inches when "ft_in")
 *     "heightUnit": "ft_in",      ← "cm" | "ft_in"  (stored as cm)
 *     "recordedAt": "2026-03-01"  ← optional, defaults to now
 *   }
 *
 * Response 201: { bodyDetails }
 */
export const create = async (req, res) => {
  const { gender, age, weight, weightUnit, height, heightUnit, recordedAt } =
    req.body;

  const storedWeight =
    weight !== undefined && weightUnit === 'lbs' ? lbsToKg(weight) : weight;

  const storedHeight =
    height !== undefined && heightUnit === 'ft_in'
      ? inchesToCm(height)
      : height;

  const bodyDetails = await BodyDetails.create({
    user: req.user._id,
    ...(gender !== undefined && { gender }),
    ...(age !== undefined && { age }),
    ...(storedWeight !== undefined && { weight: storedWeight }),
    ...(weightUnit !== undefined && { weightUnit }),
    ...(storedHeight !== undefined && { height: storedHeight }),
    ...(heightUnit !== undefined && { heightUnit }),
    ...(recordedAt !== undefined && { recordedAt }),
  });

  return res.status(201).json({ bodyDetails });
};

/**
 * GET /api/body-details
 *
 * Returns all body snapshots for the authenticated user, sorted newest first.
 *
 * Query params:
 *   ?latest=true  → returns only the most recent snapshot (as a 1-item array)
 *
 * Response 200: { bodyDetails: [...] }
 */
export const list = async (req, res) => {
  const filter = { user: req.user._id };
  const sort = { createdAt: -1 };

  if (req.query.latest === 'true') {
    const latest = await BodyDetails.findOne(filter).sort(sort);
    return res.status(200).json({ bodyDetails: latest ? [latest] : [] });
  }

  const bodyDetails = await BodyDetails.find(filter).sort(sort);
  return res.status(200).json({ bodyDetails });
};
