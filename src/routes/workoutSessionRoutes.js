import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  start,
  complete,
  patchFeedback,
  checkMissed,
  getDetail,
  upsertSet,
  batchUpsertSets,
  getProgress,
} from '../controllers/workoutSessionController.js';

const router = express.Router();

router.use(protect);

router.post('/start', start);
router.post('/check-missed', checkMissed);

router.get('/:sessionId', getDetail);
router.get('/:sessionId/progress', getProgress);
router.put('/:sessionId/exercises/:sessionExerciseId/sets/:setNumber', upsertSet);
router.post('/:sessionId/sets/batch', batchUpsertSets);
router.patch('/:sessionId/feedback', patchFeedback);
router.post('/:sessionId/complete', complete);

export default router;
