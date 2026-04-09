import express from 'express';
import { protect } from '../middleware/auth.js';
import { upsert, list } from '../controllers/bodyDetailsController.js';

const router = express.Router();

router.use(protect); // all /api/body-details/* routes require a valid JWT

router.put('/', upsert);
router.post('/', upsert); // same as PUT — avoids duplicate docs from older clients
router.get('/', list);

export default router;
