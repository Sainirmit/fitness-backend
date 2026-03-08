import express from 'express';
import { protect } from '../middleware/auth.js';
import { getMe, updateMe } from '../controllers/userController.js';

const router = express.Router();

router.use(protect); // all /api/users/* routes require a valid JWT

router.get('/me', getMe);
router.patch('/me', updateMe);

export default router;
