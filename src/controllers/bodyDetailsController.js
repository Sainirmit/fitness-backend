import BodyDetails from '../models/BodyDetails.js';
import { createBodyDetailsForUser } from '../services/bodyDetailsService.js';

/**
 * PUT /api/body-details  (preferred)
 * POST /api/body-details  (same behavior — create snapshot)
 *
 * Creates a new body-metrics snapshot document for the authenticated user.
 * Use recordedAt to backdate (optional).
 *
 * Payload:
 *   {
 *     "gender":     "male",
 *     "age":        28,
 *     "weight":     180,          ← in weightUnit
 *     "weightUnit": "lbs",        ← "kg" | "lbs"  (stored as kg)
 *     "height":     71,           ← in heightUnit (total inches when "ft_in")
 *     "heightUnit": "ft_in",      ← "cm" | "ft_in"  (stored as cm)
 *     "recordedAt": "2026-03-01"  ← optional
 *   }
 *
 * Response 200: { bodyDetails }
 * Response 400: no recognized fields to persist
 */
export const upsert = async (req, res) => {
  const bodyDetails = await createBodyDetailsForUser(req.user._id, req.body);

  if (!bodyDetails) {
    return res.status(400).json({
      message:
        'Provide at least one field to save (e.g. gender, age, weight, height, weightUnit, heightUnit, recordedAt).',
    });
  }

  return res.status(200).json({ bodyDetails });
};

/**
 * GET /api/body-details
 *
 * Returns body details snapshots for the authenticated user (0..N documents).
 *
 * Query params:
 *   ?latest=true  → returns just the latest snapshot (as a 0/1 array)
 *
 * Response 200: { bodyDetails: [...] }
 */
export const list = async (req, res) => {
  const filter = { user: req.user._id };
  const sort = { recordedAt: -1, createdAt: -1 };

  if (req.query.latest === 'true') {
    const latest = await BodyDetails.findOne(filter).sort(sort);
    return res.status(200).json({ bodyDetails: latest ? [latest] : [] });
  }

  const bodyDetails = await BodyDetails.find(filter).sort(sort);
  return res.status(200).json({ bodyDetails });
};
