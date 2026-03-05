import express from 'express';
import { create, list } from '../controllers/bodyDetailsController.js';

const router = express.Router();

router.post('/', create);
router.get('/', list);

export default router;
