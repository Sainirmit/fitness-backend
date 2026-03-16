import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  uploadBodyPhotos,
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

// Upload body photos (multipart form data)
router.post('/upload', uploadBodyPhotos);

// Get upload signed URL (for direct upload)
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
