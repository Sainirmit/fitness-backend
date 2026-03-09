import express from 'express';
import { googleLogin, appleLogin } from '../controllers/authController.js';
import { validateGoogleLogin, validateAppleLogin } from '../middleware/validation.js';

const router = express.Router();

router.post('/google', validateGoogleLogin, googleLogin);
router.post('/apple', validateAppleLogin, appleLogin);

export default router;
