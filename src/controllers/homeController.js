import {
  buildDashboard,
  buildReplacementSheetOptions,
  listReplacements,
  createReplacement,
  deleteReplacement,
} from "../services/homeDashboardService.js";
import { isValidDateKey } from "../services/workoutOccurrenceService.js";
import {
  resolveTimeZone,
  syncUserTimeZoneFromHeader,
} from "../utils/timezone.js";

/**
 * GET /api/home/dashboard?dateKey=YYYY-MM-DD&timeZone=America/New_York
 */
export const getDashboard = async (req, res, next) => {
  try {
    const { dateKey } = req.query;

    if (!dateKey || !isValidDateKey(dateKey)) {
      return res
        .status(400)
        .json({ message: "dateKey (YYYY-MM-DD) is required." });
    }

    // App-open sync: if client sends x-timezone and it changed, persist it.
    await syncUserTimeZoneFromHeader(req, req.user);
    const timeZone = resolveTimeZone(req, req.user);

    const dashboard = await buildDashboard(req.user._id, dateKey, timeZone);

    return res.status(200).json({
      user: {
        _id: req.user._id,
        name: req.user.name,
        timeOfDay: dashboard.timeOfDay,
      },
      ...dashboard,
    });
  } catch (err) {
    if (err.status)
      return res.status(err.status).json({ message: err.message });
    next(err);
  }
};

/**
 * GET /api/home/workout-replacements?dateKey=YYYY-MM-DD
 *
 * Returns persistent replacement rules AND the replacement-sheet option list
 * with yesterday-completed exclusion logic applied.
 */
export const getReplacements = async (req, res, next) => {
  try {
    const { dateKey } = req.query;
    const replacements = await listReplacements(req.user._id);

    let sheetOptions = null;
    if (dateKey && isValidDateKey(dateKey)) {
      sheetOptions = await buildReplacementSheetOptions(req.user._id, dateKey);
    }

    return res.status(200).json({
      replacements,
      ...(sheetOptions && { sheetOptions }),
    });
  } catch (err) {
    if (err.status)
      return res.status(err.status).json({ message: err.message });
    next(err);
  }
};

/**
 * POST /api/home/workout-replacements
 * Body: { originalWorkoutDayId, replacementWorkoutDayId }
 */
export const upsertReplacement = async (req, res, next) => {
  try {
    const { originalWorkoutDayId, replacementWorkoutDayId } = req.body;
    const replacement = await createReplacement(req.user._id, {
      originalWorkoutDayId,
      replacementWorkoutDayId,
    });
    return res.status(200).json({
      message: "Workout day replacement saved.",
      replacement,
    });
  } catch (err) {
    if (err.status)
      return res.status(err.status).json({ message: err.message });
    next(err);
  }
};

/**
 * DELETE /api/home/workout-replacements/:replacementId
 */
export const removeReplacement = async (req, res, next) => {
  try {
    await deleteReplacement(req.user._id, req.params.replacementId);
    return res
      .status(200)
      .json({ message: "Replacement removed. Day restored to original." });
  } catch (err) {
    if (err.status)
      return res.status(err.status).json({ message: err.message });
    next(err);
  }
};
