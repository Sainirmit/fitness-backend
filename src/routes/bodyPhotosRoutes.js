import express from 'express';
import { protect } from '../middleware/auth.js';
import { photoUploadLimiter } from '../middleware/rateLimit.js';
import {
  create,
  list,
  getById,
  update,
  remove,
  getUploadUrl,
  getAccessUrl,
} from '../controllers/bodyPhotosController.js';

const router = express.Router();

router.use(protect);

router.get('/upload-url', photoUploadLimiter, getUploadUrl);
router.get('/access-url/:photoId', getAccessUrl);

router.post('/', photoUploadLimiter, create);
router.get('/', list);
router.get('/:id', getById);
router.patch('/:id', update);
router.delete('/:id', remove);

export default router;
