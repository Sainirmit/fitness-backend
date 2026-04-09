import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Mongoose models so tests run without a DB connection
// ---------------------------------------------------------------------------

const mockSessionExercises = [];
const mockSetLogs = [];

vi.mock('../models/WorkoutSessionExercise.js', () => {
  const countDocuments = vi.fn(() => mockSessionExercises.length);
  const find = vi.fn(() => ({
    populate: vi.fn().mockReturnThis(),
    sort: vi.fn(() => ({ lean: vi.fn(() => mockSessionExercises) })),
  }));
  const insertMany = vi.fn(async (docs) => {
    docs.forEach((d) => mockSessionExercises.push({ ...d, _id: `se_${d.orderInSession}` }));
  });

  return {
    default: { countDocuments, find, insertMany, findById: vi.fn() },
  };
});

vi.mock('../models/WorkoutSetLog.js', () => {
  const find = vi.fn(() => ({
    sort: vi.fn(() => ({ lean: vi.fn(() => mockSetLogs) })),
    lean: vi.fn(() => mockSetLogs),
  }));
  const findOneAndUpdate = vi.fn(async (filter, update) => ({
    ...filter,
    ...update.$set,
    ...update.$setOnInsert,
  }));
  const countDocuments = vi.fn(() => mockSetLogs.filter((l) => l.isCompleted).length);

  return {
    default: { find, findOneAndUpdate, countDocuments },
  };
});

vi.mock('../models/WorkoutDayExercise.js', () => {
  const find = vi.fn(() => ({
    sort: vi.fn(() => ({
      lean: vi.fn(() => [
        { _id: 'de_1', orderInDay: 1, prescribedSets: 3 },
        { _id: 'de_2', orderInDay: 2, prescribedSets: 4 },
      ]),
    })),
  }));
  return { default: { find } };
});

vi.mock('../models/WorkoutSession.js', () => ({
  default: {
    findOne: vi.fn(() => ({
      lean: vi.fn(() => ({ _id: 'session_1', status: 'in_progress', user: 'user_1' })),
      select: vi.fn(() => ({ _id: 'session_1', status: 'in_progress' })),
    })),
  },
}));

import {
  bootstrapSessionExercises,
  computeSessionProgress,
} from '../services/workoutTrackingService.js';
import WorkoutSessionExercise from '../models/WorkoutSessionExercise.js';
import WorkoutDayExercise from '../models/WorkoutDayExercise.js';

beforeEach(() => {
  mockSessionExercises.length = 0;
  mockSetLogs.length = 0;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Bootstrap session exercises
// ---------------------------------------------------------------------------

describe('bootstrapSessionExercises', () => {
  it('creates session exercises from planned day exercises', async () => {
    WorkoutSessionExercise.countDocuments.mockReturnValueOnce(0);

    await bootstrapSessionExercises('session_1', 'day_1');

    expect(WorkoutDayExercise.find).toHaveBeenCalledWith({ workoutDay: 'day_1' });
    expect(WorkoutSessionExercise.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          workoutSession: 'session_1',
          workoutDayExercise: 'de_1',
          orderInSession: 1,
        }),
        expect.objectContaining({
          workoutSession: 'session_1',
          workoutDayExercise: 'de_2',
          orderInSession: 2,
        }),
      ]),
      { ordered: false },
    );
  });

  it('skips bootstrap when session exercises already exist', async () => {
    WorkoutSessionExercise.countDocuments.mockReturnValueOnce(2);

    await bootstrapSessionExercises('session_1', 'day_1');

    expect(WorkoutSessionExercise.insertMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Progress computation
// ---------------------------------------------------------------------------

describe('computeSessionProgress', () => {
  it('returns zero progress when no set logs exist', async () => {
    mockSessionExercises.push(
      {
        _id: 'se_1',
        orderInSession: 1,
        workoutDayExercise: { prescribedSets: 3, exercise: { exerciseType: 'strength' } },
      },
      {
        _id: 'se_2',
        orderInSession: 2,
        workoutDayExercise: { prescribedSets: 4, exercise: { exerciseType: 'strength' } },
      },
    );

    const progress = await computeSessionProgress('session_1');

    expect(progress.totalExercises).toBe(2);
    expect(progress.completedExercises).toBe(0);
    expect(progress.totalPrescribedSets).toBe(7);
    expect(progress.completedSets).toBe(0);
    expect(progress.percent).toBe(0);
  });

  it('computes partial progress correctly', async () => {
    mockSessionExercises.push(
      {
        _id: 'se_1',
        orderInSession: 1,
        workoutDayExercise: { prescribedSets: 3, exercise: { exerciseType: 'strength' } },
      },
      {
        _id: 'se_2',
        orderInSession: 2,
        workoutDayExercise: { prescribedSets: 4, exercise: { exerciseType: 'strength' } },
      },
    );

    mockSetLogs.push(
      { workoutSessionExercise: 'se_1', setNumber: 1, isCompleted: true },
      { workoutSessionExercise: 'se_1', setNumber: 2, isCompleted: true },
    );

    const progress = await computeSessionProgress('session_1');

    expect(progress.completedSets).toBe(2);
    expect(progress.totalPrescribedSets).toBe(7);
    expect(progress.percent).toBe(29);
    expect(progress.completedExercises).toBe(0);
  });

  it('marks exercise as done when all prescribed sets completed', async () => {
    mockSessionExercises.push({
      _id: 'se_1',
      orderInSession: 1,
      workoutDayExercise: { prescribedSets: 2, exercise: { exerciseType: 'bodyweight' } },
    });

    mockSetLogs.push(
      { workoutSessionExercise: 'se_1', setNumber: 1, isCompleted: true },
      { workoutSessionExercise: 'se_1', setNumber: 2, isCompleted: true },
    );

    const progress = await computeSessionProgress('session_1');

    expect(progress.completedExercises).toBe(1);
    expect(progress.percent).toBe(100);
    expect(progress.exercises[0].done).toBe(true);
  });

  it('treats cardio as 1 prescribed set', async () => {
    mockSessionExercises.push({
      _id: 'se_1',
      orderInSession: 1,
      workoutDayExercise: { prescribedSets: 1, exercise: { exerciseType: 'cardio' } },
    });

    mockSetLogs.push(
      { workoutSessionExercise: 'se_1', setNumber: 1, isCompleted: true },
    );

    const progress = await computeSessionProgress('session_1');

    expect(progress.totalPrescribedSets).toBe(1);
    expect(progress.completedSets).toBe(1);
    expect(progress.completedExercises).toBe(1);
    expect(progress.percent).toBe(100);
    expect(progress.exercises[0].exerciseType).toBe('cardio');
    expect(progress.exercises[0].done).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cardio clamp in generation prompt logic
// ---------------------------------------------------------------------------

describe('cardio clamp logic (pure)', () => {
  it('clamps cardio exercises to 1 set and 0 reps', () => {
    const exercises = [
      { _id: 'ex_1', exerciseType: 'strength' },
      { _id: 'ex_2', exerciseType: 'cardio' },
    ];
    const plan = {
      days: [
        {
          exercises: [
            { exerciseId: 'ex_1', prescribedSets: 3, prescribedRepMin: 10, prescribedRepMax: 12 },
            { exerciseId: 'ex_2', prescribedSets: 3, prescribedRepMin: 10, prescribedRepMax: 12 },
          ],
        },
      ],
    };

    const cardioIds = new Set(
      exercises.filter((e) => e.exerciseType === 'cardio').map((e) => e._id.toString()),
    );
    for (const day of plan.days) {
      for (const ex of day.exercises) {
        if (cardioIds.has(String(ex.exerciseId))) {
          ex.prescribedSets = 1;
          ex.prescribedRepMin = 0;
          ex.prescribedRepMax = 0;
        }
      }
    }

    expect(plan.days[0].exercises[0].prescribedSets).toBe(3);
    expect(plan.days[0].exercises[0].prescribedRepMin).toBe(10);
    expect(plan.days[0].exercises[1].prescribedSets).toBe(1);
    expect(plan.days[0].exercises[1].prescribedRepMin).toBe(0);
    expect(plan.days[0].exercises[1].prescribedRepMax).toBe(0);
  });
});
