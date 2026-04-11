import express from 'express';
import { protect } from '../middleware/auth.js';
import { noHttpCache } from '../middleware/noHttpCache.js';
import { aiGenerationLimiter, pollingLimiter } from '../middleware/rateLimit.js';
import {
  generate,
  getGenerationStatus,
  getCurrent,
  getRefinementStatus,
  listOccurrences,
  ensureOccurrenceSlots,
  resetTemplateStatus,
} from '../controllers/workoutPlanController.js';

const router = express.Router();

router.use(protect);

router.post('/generate', aiGenerationLimiter, generate);
router.get(
  '/generation-status/:planId',
  noHttpCache,
  pollingLimiter,
  getGenerationStatus,
);
router.get('/occurrences', listOccurrences);
router.post('/occurrences/ensure', ensureOccurrenceSlots);
router.post('/current/reset-template-status', resetTemplateStatus);
router.get('/current', getCurrent);
router.get(
  '/refinement-status/:bodyPhotosId',
  noHttpCache,
  pollingLimiter,
  getRefinementStatus,
);

export default router;
