import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  getDashboard,
  getReplacements,
  upsertReplacement,
  removeReplacement,
} from '../controllers/homeController.js';

const router = express.Router();

router.use(protect);

router.get('/dashboard', getDashboard);
router.get('/workout-replacements', getReplacements);
router.post('/workout-replacements', upsertReplacement);
router.delete('/workout-replacements/:replacementId', removeReplacement);

export default router;
