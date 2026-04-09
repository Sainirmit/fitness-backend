import BodyPhotos from "../models/BodyPhotos.js";
import BodyDetails from "../models/BodyDetails.js";
import User from "../models/User.js";
import {
  deleteFromS3,
  generateFileName,
  extractFileNameFromUrl,
  getAccessSignedUrl,
  getUploadSignedUrl,
} from "../config/s3.js";
import { enqueueRefinement } from "../services/photoRefinementOrchestrator.js";
import { checkRefinementEligibility } from "../middleware/refinementGuard.js";

async function resolveBodyDetailsIdForUser(userId, bodyDetailsId) {
  if (bodyDetailsId) {
    const doc = await BodyDetails.findOne({ _id: bodyDetailsId, user: userId }).select(
      { _id: 1 },
    );
    return doc?._id ?? null;
  }

  const latest = await BodyDetails.findOne({ user: userId })
    .sort({ recordedAt: -1, createdAt: -1 })
    .select({ _id: 1 });
  return latest?._id ?? null;
}

/**
 * Create body photos with URLs (after client uploads via presigned URLs from GET /upload-url)
 * POST /api/body-photos
 * Protected: requires valid JWT
 */
export const create = async (req, res, next) => {
  try {
    const { frontImageUrl, sideImageUrl, bodyDetailsId, periodType } = req.body;
    const userId = req.user._id;

    if (!frontImageUrl || !sideImageUrl) {
      return res.status(400).json({
        message: "Both frontImageUrl and sideImageUrl are required",
      });
    }

    const resolvedBodyDetailsId = await resolveBodyDetailsIdForUser(
      userId,
      bodyDetailsId,
    );

    if (bodyDetailsId && !resolvedBodyDetailsId) {
      return res.status(400).json({
        message: "bodyDetailsId is invalid (or does not belong to this user)",
      });
    }

    const eligibility = await checkRefinementEligibility(userId);
    if (!eligibility.eligible) {
      return res.status(409).json({
        code: eligibility.code,
        message: eligibility.reason,
        retryAfter: eligibility.retryAfter || null,
        retryable: false,
      });
    }

    const bodyPhotos = await BodyPhotos.create({
      user: userId,
      bodyDetails: resolvedBodyDetailsId,
      frontImageUrl,
      sideImageUrl,
      periodType: periodType || "",
      recordedAt: new Date(),
      analysisStatus: "pending",
    });

    await User.findByIdAndUpdate(userId, { $set: { hasBodyPhotos: true } });
    enqueueRefinement(userId, bodyPhotos._id);

    res.status(201).json({
      message: "Body photos created successfully",
      bodyPhotos,
      refinementStatus: "queued",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List body photos for user
 * GET /api/body-photos
 * Protected: requires valid JWT
 */
export const list = async (req, res, next) => {
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
      .populate("bodyDetails", "weight height bodyFat");

    // Generate signed URLs for each photo set
    const bodyPhotosWithUrls = await Promise.all(
      bodyPhotos.map(async (photo) => {
        const frontFileName = extractFileNameFromUrl(photo.frontImageUrl);
        const sideFileName = extractFileNameFromUrl(photo.sideImageUrl);

        const [frontSignedUrl, sideSignedUrl] = await Promise.all([
          frontFileName
            ? getAccessSignedUrl(frontFileName)
            : photo.frontImageUrl,
          sideFileName ? getAccessSignedUrl(sideFileName) : photo.sideImageUrl,
        ]);

        return {
          ...photo.toObject(),
          frontImageUrl: frontSignedUrl,
          sideImageUrl: sideSignedUrl,
        };
      }),
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
    next(error);
  }
};

/**
 * Get body photos by ID
 * GET /api/body-photos/:id
 * Protected: requires valid JWT
 */
export const getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const bodyPhotos = await BodyPhotos.findOne({
      _id: id,
      user: userId,
    }).populate("bodyDetails", "weight height bodyFat");

    if (!bodyPhotos) {
      return res.status(404).json({
        message: "Body photos not found",
      });
    }

    // Generate signed URLs for the images
    const frontFileName = extractFileNameFromUrl(bodyPhotos.frontImageUrl);
    const sideFileName = extractFileNameFromUrl(bodyPhotos.sideImageUrl);

    const [frontSignedUrl, sideSignedUrl] = await Promise.all([
      frontFileName
        ? getAccessSignedUrl(frontFileName)
        : bodyPhotos.frontImageUrl,
      sideFileName ? getAccessSignedUrl(sideFileName) : bodyPhotos.sideImageUrl,
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
    next(error);
  }
};

/**
 * Update body photos
 * PATCH /api/body-photos/:id
 * Protected: requires valid JWT
 */
export const update = async (req, res, next) => {
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
      { new: true, runValidators: true },
    ).populate("bodyDetails", "weight height bodyFat");

    if (!bodyPhotos) {
      return res.status(404).json({
        message: "Body photos not found",
      });
    }

    res.status(200).json({
      message: "Body photos updated successfully",
      bodyPhotos,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete body photos
 * DELETE /api/body-photos/:id
 * Protected: requires valid JWT
 */
export const remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const bodyPhotos = await BodyPhotos.findOne({ _id: id, user: userId });
    if (!bodyPhotos) {
      return res.status(404).json({
        message: "Body photos not found",
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
      message: "Body photos deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get upload signed URL for direct upload
 * GET /api/body-photos/upload-url
 * Protected: requires valid JWT
 */
export const getUploadUrl = async (req, res, next) => {
  try {
    const { fileName, contentType, imageType } = req.query;
    const userId = req.user._id;

    if (!fileName || !contentType || !imageType) {
      return res.status(400).json({
        message: "fileName, contentType, and imageType are required",
      });
    }

    if (!["front", "side"].includes(imageType)) {
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
    next(error);
  }
};

/**
 * Get access signed URL for viewing images
 * GET /api/body-photos/access-url/:photoId
 * Protected: requires valid JWT
 */
export const getAccessUrl = async (req, res, next) => {
  try {
    const { photoId } = req.params;
    const userId = req.user._id;
    const { imageType } = req.query; // 'front' or 'side'

    if (!["front", "side"].includes(imageType)) {
      return res.status(400).json({
        message: 'imageType must be either "front" or "side"',
      });
    }

    const bodyPhotos = await BodyPhotos.findOne({ _id: photoId, user: userId });
    if (!bodyPhotos) {
      return res.status(404).json({
        message: "Body photos not found",
      });
    }

    const imageUrl =
      imageType === "front"
        ? bodyPhotos.frontImageUrl
        : bodyPhotos.sideImageUrl;
    const fileName = extractFileNameFromUrl(imageUrl);

    if (!fileName) {
      return res.status(400).json({
        message: "Image not found",
      });
    }

    const signedUrl = await getAccessSignedUrl(fileName);

    res.status(200).json({
      signedUrl,
      imageType,
    });
  } catch (error) {
    next(error);
  }
};
