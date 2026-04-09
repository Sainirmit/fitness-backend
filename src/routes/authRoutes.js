import express from 'express';
import { googleLogin, appleLogin, logout } from '../controllers/authController.js';
import { validateGoogleLogin, validateAppleLogin } from '../middleware/validation.js';
import { protect } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

router.use(authLimiter);

router.post('/google', validateGoogleLogin, googleLogin);
router.post('/apple', validateAppleLogin, appleLogin);
router.post('/logout', protect, logout);

export default router;
