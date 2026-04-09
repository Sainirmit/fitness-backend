import BodyDetails from '../models/BodyDetails.js';

const lbsToKg = (lbs) => Math.round(lbs * 0.453592 * 10) / 10;
const inchesToCm = (inches) => Math.round(inches * 2.54 * 10) / 10;

/**
 * Maps request fields to stored BodyDetails shape (kg / cm). Only includes keys that were sent.
 */
export function bodyDetailsFieldsToSet({
  gender,
  age,
  weight,
  weightUnit,
  height,
  heightUnit,
  recordedAt,
}) {
  const set = {};

  if (gender !== undefined) set.gender = gender;
  if (age !== undefined) set.age = age;

  if (weight !== undefined) {
    set.weight = weightUnit === 'lbs' ? lbsToKg(weight) : weight;
  }
  if (weightUnit !== undefined) set.weightUnit = weightUnit;

  if (height !== undefined) {
    set.height = heightUnit === 'ft_in' ? inchesToCm(height) : height;
  }
  if (heightUnit !== undefined) set.heightUnit = heightUnit;

  if (recordedAt !== undefined) set.recordedAt = recordedAt;

  return set;
}

/**
 * Create a BodyDetails snapshot for the user.
 * BodyDetails is a time-series: multiple snapshots per user are allowed.
 */
export async function createBodyDetailsForUser(userId, body) {
  const set = bodyDetailsFieldsToSet(body);
  if (Object.keys(set).length === 0) return null;

  set.user = userId;

  const doc = await BodyDetails.create(set);
  return doc;
}

// Backward-compat alias (older callers still use the old name).
export const upsertBodyDetailsForUser = createBodyDetailsForUser;
