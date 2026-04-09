import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// S3 bucket configuration
const BUCKET_NAME = process.env.AWS_BUCKET_NAME;

/**
 * Upload image to S3 bucket
 * @param {Buffer} buffer - Image buffer
 * @param {string} fileName - Unique file name
 * @param {string} contentType - MIME type of the file
 * @returns {Promise<string>} - Public URL of uploaded image
 */
export const uploadToS3 = async (buffer, fileName, contentType) => {
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: buffer,
      ContentType: contentType,
      // Remove ACL as bucket doesn't support it
      // Files will be private by default, accessible via signed URLs
    });

    await s3Client.send(command);
    
    // Return URL - will need to be accessed via signed URL or bucket policy
    return `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
  } catch (error) {
    console.error('S3 upload error:', error);
    throw new Error('Failed to upload image to S3');
  }
};

/**
 * Get signed URL for direct upload (for large files)
 * @param {string} fileName - File name
 * @param {string} contentType - MIME type
 * @returns {Promise<string>} - Signed URL for upload
 */
export const getUploadSignedUrl = async (fileName, contentType) => {
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileName,
      ContentType: contentType,
      // Remove ACL as bucket doesn't support it
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return signedUrl;
  } catch (error) {
    console.error('S3 signed URL error:', error);
    throw new Error('Failed to generate upload URL');
  }
};

/**
 * Delete image from S3 bucket
 * @param {string} fileName - File name to delete
 * @returns {Promise<void>}
 */
export const deleteFromS3 = async (fileName) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileName,
    });

    await s3Client.send(command);
  } catch (error) {
    console.error('S3 delete error:', error);
    throw new Error('Failed to delete image from S3');
  }
};

/**
 * Generate unique file name
 * @param {string} userId - User ID
 * @param {string} imageType - 'front' or 'side'
 * @param {string} originalName - Original file name
 * @returns {string} - Unique file name
 */
export const generateFileName = (userId, imageType, originalName) => {
  const timestamp = Date.now();
  const extension = originalName.split('.').pop();
  return `body-photos/${userId}/${imageType}-${timestamp}.${extension}`;
};

/**
 * Get signed URL for accessing private files
 * @param {string} fileName - File name
 * @returns {Promise<string>} - Signed URL for access
 */
export const getAccessSignedUrl = async (fileName) => {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileName,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return signedUrl;
  } catch (error) {
    console.error('S3 access URL error:', error);
    throw new Error('Failed to generate access URL');
  }
};

/**
 * Extract file name from S3 URL
 * @param {string} s3Url - Full S3 URL
 * @returns {string} - File name only
 */
export const extractFileNameFromUrl = (s3Url) => {
  if (!s3Url) return null;
  return s3Url.split('/').pop();
};

/**
 * Extract the full S3 object key from a public S3 URL.
 * e.g. "https://bucket.s3.region.amazonaws.com/body-photos/uid/front-123.jpg"
 *   → "body-photos/uid/front-123.jpg"
 * @param {string} s3Url
 * @returns {string|null}
 */
export const extractS3KeyFromUrl = (s3Url) => {
  if (!s3Url) return null;
  try {
    const url = new URL(s3Url);
    return decodeURIComponent(url.pathname.slice(1));
  } catch {
    return s3Url;
  }
};

export { s3Client, BUCKET_NAME };
