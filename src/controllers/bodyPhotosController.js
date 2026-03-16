import multer from 'multer';
import BodyPhotos from '../models/BodyPhotos.js';
import { uploadToS3, deleteFromS3, generateFileName, extractFileNameFromUrl, getAccessSignedUrl, getUploadSignedUrl } from '../config/s3.js';

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

/**
 * Upload body photos (front and side)
 * POST /api/body-photos/upload
 * Protected: requires valid JWT
 */
export const uploadBodyPhotos = [
  upload.fields([
    { name: 'frontImage', maxCount: 1 },
    { name: 'sideImage', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { bodyDetailsId, periodType } = req.body;
      const userId = req.user._id;

      if (!req.files.frontImage || !req.files.sideImage) {
        return res.status(400).json({
          message: 'Both frontImage and sideImage files are required',
        });
      }

      // Upload front image to S3
      const frontFileName = generateFileName(
        userId,
        'front',
        req.files.frontImage[0].originalname
      );
      const frontImageUrl = await uploadToS3(
        req.files.frontImage[0].buffer,
        frontFileName,
        req.files.frontImage[0].mimetype
      );

      // Upload side image to S3
      const sideFileName = generateFileName(
        userId,
        'side',
        req.files.sideImage[0].originalname
      );
      const sideImageUrl = await uploadToS3(
        req.files.sideImage[0].buffer,
        sideFileName,
        req.files.sideImage[0].mimetype
      );

      // Create body photos record
      const bodyPhotos = await BodyPhotos.create({
        user: userId,
        bodyDetails: bodyDetailsId || null,
        frontImageUrl,
        sideImageUrl,
        periodType: periodType || '',
        recordedAt: new Date(),
      });

      // Generate signed URLs for accessing the images
      const frontAccessFileName = extractFileNameFromUrl(frontImageUrl);
      const sideAccessFileName = extractFileNameFromUrl(sideImageUrl);
      
      const [frontSignedUrl, sideSignedUrl] = await Promise.all([
        getAccessSignedUrl(frontAccessFileName),
        getAccessSignedUrl(sideAccessFileName)
      ]);

      const responseBodyPhotos = {
        ...bodyPhotos.toObject(),
        frontImageUrl: frontSignedUrl,
        sideImageUrl: sideSignedUrl,
      };

      res.status(201).json({
        message: 'Body photos uploaded successfully',
        bodyPhotos: responseBodyPhotos,
      });
    } catch (error) {
      console.error('Upload body photos error:', error);
      res.status(500).json({
        message: 'Failed to upload body photos',
        error: error.message,
      });
    }
  },
];

/**
 * Create body photos with URLs (for direct upload)
 * POST /api/body-photos
 * Protected: requires valid JWT
 */
export const create = async (req, res) => {
  try {
    const { frontImageUrl, sideImageUrl, bodyDetailsId, periodType } = req.body;
    const userId = req.user._id;

    if (!frontImageUrl || !sideImageUrl) {
      return res.status(400).json({
        message: 'Both frontImageUrl and sideImageUrl are required',
      });
    }

    const bodyPhotos = await BodyPhotos.create({
      user: userId,
      bodyDetails: bodyDetailsId || null,
      frontImageUrl,
      sideImageUrl,
      periodType: periodType || '',
      recordedAt: new Date(),
    });

    res.status(201).json({
      message: 'Body photos created successfully',
      bodyPhotos,
    });
  } catch (error) {
    console.error('Create body photos error:', error);
    res.status(500).json({
      message: 'Failed to create body photos',
      error: error.message,
    });
  }
};

/**
 * List body photos for user
 * GET /api/body-photos
 * Protected: requires valid JWT
 */
export const list = async (req, res) => {
  try {
    const userId = req.user._id;
    const { limit = 20, page = 1, periodType } = req.query;

    const query = { user: userId };
    if (periodType) {
      query.periodType = periodType;
    }

    const bodyPhotos = await BodyPhotos.find(query)
      .sort({ recordedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('bodyDetails', 'weight height bodyFat');

    // Generate signed URLs for each photo set
    const bodyPhotosWithUrls = await Promise.all(
      bodyPhotos.map(async (photo) => {
        const frontFileName = extractFileNameFromUrl(photo.frontImageUrl);
        const sideFileName = extractFileNameFromUrl(photo.sideImageUrl);
        
        const [frontSignedUrl, sideSignedUrl] = await Promise.all([
          frontFileName ? getAccessSignedUrl(frontFileName) : photo.frontImageUrl,
          sideFileName ? getAccessSignedUrl(sideFileName) : photo.sideImageUrl
        ]);

        return {
          ...photo.toObject(),
          frontImageUrl: frontSignedUrl,
          sideImageUrl: sideSignedUrl,
        };
      })
    );

    const total = await BodyPhotos.countDocuments(query);

    res.status(200).json({
      bodyPhotos: bodyPhotosWithUrls,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('List body photos error:', error);
    res.status(500).json({
      message: 'Failed to list body photos',
      error: error.message,
    });
  }
};

/**
 * Get body photos by ID
 * GET /api/body-photos/:id
 * Protected: requires valid JWT
 */
export const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const bodyPhotos = await BodyPhotos.findOne({ _id: id, user: userId })
      .populate('bodyDetails', 'weight height bodyFat');

    if (!bodyPhotos) {
      return res.status(404).json({
        message: 'Body photos not found',
      });
    }

    // Generate signed URLs for the images
    const frontFileName = extractFileNameFromUrl(bodyPhotos.frontImageUrl);
    const sideFileName = extractFileNameFromUrl(bodyPhotos.sideImageUrl);
    
    const [frontSignedUrl, sideSignedUrl] = await Promise.all([
      frontFileName ? getAccessSignedUrl(frontFileName) : bodyPhotos.frontImageUrl,
      sideFileName ? getAccessSignedUrl(sideFileName) : bodyPhotos.sideImageUrl
    ]);

    const responseBodyPhotos = {
      ...bodyPhotos.toObject(),
      frontImageUrl: frontSignedUrl,
      sideImageUrl: sideSignedUrl,
    };

    res.status(200).json({
      bodyPhotos: responseBodyPhotos,
    });
  } catch (error) {
    console.error('Get body photos error:', error);
    res.status(500).json({
      message: 'Failed to get body photos',
      error: error.message,
    });
  }
};

/**
 * Update body photos
 * PATCH /api/body-photos/:id
 * Protected: requires valid JWT
 */
export const update = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const { periodType, bodyDetailsId } = req.body;

    const bodyPhotos = await BodyPhotos.findOneAndUpdate(
      { _id: id, user: userId },
      { 
        periodType: periodType || undefined,
        bodyDetails: bodyDetailsId || undefined,
      },
      { new: true, runValidators: true }
    ).populate('bodyDetails', 'weight height bodyFat');

    if (!bodyPhotos) {
      return res.status(404).json({
        message: 'Body photos not found',
      });
    }

    res.status(200).json({
      message: 'Body photos updated successfully',
      bodyPhotos,
    });
  } catch (error) {
    console.error('Update body photos error:', error);
    res.status(500).json({
      message: 'Failed to update body photos',
      error: error.message,
    });
  }
};

/**
 * Delete body photos
 * DELETE /api/body-photos/:id
 * Protected: requires valid JWT
 */
export const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const bodyPhotos = await BodyPhotos.findOne({ _id: id, user: userId });
    if (!bodyPhotos) {
      return res.status(404).json({
        message: 'Body photos not found',
      });
    }

    // Delete images from S3
    if (bodyPhotos.frontImageUrl) {
      const frontFileName = extractFileNameFromUrl(bodyPhotos.frontImageUrl);
      if (frontFileName) {
        await deleteFromS3(frontFileName);
      }
    }

    if (bodyPhotos.sideImageUrl) {
      const sideFileName = extractFileNameFromUrl(bodyPhotos.sideImageUrl);
      if (sideFileName) {
        await deleteFromS3(sideFileName);
      }
    }

    // Delete database record
    await BodyPhotos.deleteOne({ _id: id });

    res.status(200).json({
      message: 'Body photos deleted successfully',
    });
  } catch (error) {
    console.error('Delete body photos error:', error);
    res.status(500).json({
      message: 'Failed to delete body photos',
      error: error.message,
    });
  }
};

/**
 * Get upload signed URL for direct upload
 * GET /api/body-photos/upload-url
 * Protected: requires valid JWT
 */
export const getUploadUrl = async (req, res) => {
  try {
    const { fileName, contentType, imageType } = req.query;
    const userId = req.user._id;

    if (!fileName || !contentType || !imageType) {
      return res.status(400).json({
        message: 'fileName, contentType, and imageType are required',
      });
    }

    if (!['front', 'side'].includes(imageType)) {
      return res.status(400).json({
        message: 'imageType must be either "front" or "side"',
      });
    }

    const finalFileName = generateFileName(userId, imageType, fileName);
    const signedUrl = await getUploadSignedUrl(finalFileName, contentType);

    res.status(200).json({
      signedUrl,
      fileName: finalFileName,
      publicUrl: `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${finalFileName}`,
    });
  } catch (error) {
    console.error('Get upload URL error:', error);
    res.status(500).json({
      message: 'Failed to generate upload URL',
      error: error.message,
    });
  }
};

/**
 * Get access signed URL for viewing images
 * GET /api/body-photos/access-url/:photoId
 * Protected: requires valid JWT
 */
export const getAccessUrl = async (req, res) => {
  try {
    const { photoId } = req.params;
    const userId = req.user._id;
    const { imageType } = req.query; // 'front' or 'side'

    if (!['front', 'side'].includes(imageType)) {
      return res.status(400).json({
        message: 'imageType must be either "front" or "side"',
      });
    }

    const bodyPhotos = await BodyPhotos.findOne({ _id: photoId, user: userId });
    if (!bodyPhotos) {
      return res.status(404).json({
        message: 'Body photos not found',
      });
    }

    const imageUrl = imageType === 'front' ? bodyPhotos.frontImageUrl : bodyPhotos.sideImageUrl;
    const fileName = extractFileNameFromUrl(imageUrl);

    if (!fileName) {
      return res.status(400).json({
        message: 'Image not found',
      });
    }

    const signedUrl = await getAccessSignedUrl(fileName);

    res.status(200).json({
      signedUrl,
      imageType,
    });
  } catch (error) {
    console.error('Get access URL error:', error);
    res.status(500).json({
      message: 'Failed to generate access URL',
      error: error.message,
    });
  }
};
