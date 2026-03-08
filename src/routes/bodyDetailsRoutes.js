import express from 'express';
import { protect } from '../middleware/auth.js';
import { create, list } from '../controllers/bodyDetailsController.js';

const router = express.Router();

router.use(protect); // all /api/body-details/* routes require a valid JWT

router.post('/', create);
router.get('/', list);

export default router;
