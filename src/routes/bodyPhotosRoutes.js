import express from 'express';
import { protect } from '../middleware/auth.js';
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

// All routes require authentication
router.use(protect);

// Get upload signed URL (for direct upload to S3, then POST / with public URLs)
router.get('/upload-url', getUploadUrl);

// Get access signed URL (for viewing images)
router.get('/access-url/:photoId', getAccessUrl);

// CRUD operations
router.post('/', create);
router.get('/', list);
router.get('/:id', getById);
router.patch('/:id', update);
router.delete('/:id', remove);

export default router;
