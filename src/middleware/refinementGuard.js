import WorkoutPlan from "../models/WorkoutPlan.js";

/**
 * Checks whether the user is eligible for a new photo-based workout
 * enhancement. Enhancement is allowed once per active plan window.
 * After the plan's endDate passes, a new enhancement becomes available.
 *
 * Returns { eligible, reason?, retryAfter? }.
 */
export async function checkRefinementEligibility(userId) {
  const activePlan = await WorkoutPlan.findOne({
    user: userId,
    status: "active",
  })
    .sort({ generatedAt: -1 })
    .select("_id startDate endDate generationType")
    .lean();

  if (!activePlan) {
    return { eligible: true };
  }

  if (!activePlan.endDate) {
    return { eligible: true };
  }

  const now = new Date();
  const planWindowEnd = new Date(activePlan.endDate);

  if (now > planWindowEnd) {
    return { eligible: true };
  }

  const existingRefinement = await WorkoutPlan.findOne({
    user: userId,
    generationType: "photo_refinement",
    $or: [{ status: "active" }, { status: "archived" }],
    createdAt: { $gte: activePlan.startDate },
  })
    .select("_id")
    .lean();

  if (existingRefinement) {
    return {
      eligible: false,
      reason:
        "You have already enhanced your workout for the current plan period. " +
        "Enhancement will be available again after your current plan ends.",
      retryAfter: planWindowEnd.toISOString(),
      code: "REFINEMENT_ALREADY_USED",
    };
  }

  return { eligible: true };
}
