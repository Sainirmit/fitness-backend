import express from 'express';
import { getMe, updateMe } from '../controllers/userController.js';

const router = express.Router();

router.get('/me', getMe);
router.patch('/me', updateMe);

export default router;
