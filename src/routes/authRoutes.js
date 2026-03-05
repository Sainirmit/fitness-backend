import express from 'express';
import { googleLogin, appleLogin } from '../controllers/authController.js';

const router = express.Router();

router.post('/google', googleLogin);
router.post('/apple', appleLogin);

export default router;
