# AWS S3 Image Upload Guide

## Overview

This guide explains how to upload and manage body photos using AWS S3 storage.

## Setup

### 1. AWS S3 Bucket Configuration

1. **Create S3 Bucket**:
   - Go to AWS S3 Console
   - Click "Create bucket"
   - Bucket name: `your-fitness-app-bucket` (unique globally)
   - Region: Choose your preferred region (e.g., `us-east-1`)
   - Block Public Access settings: Uncheck "Block all public access"
   - Enable "ACLs enabled"

2. **CORS Configuration** (if needed for frontend):
   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
       "AllowedOrigins": ["*"],
       "ExposeHeaders": []
     }
   ]
   ```

3. **IAM Policy** for your bucket:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "AWS": "arn:aws:iam::ACCOUNT-ID:user/your-iam-user"
         },
         "Action": [
           "s3:PutObject",
           "s3:GetObject",
           "s3:DeleteObject"
         ],
         "Resource": "arn:aws:s3:::your-fitness-app-bucket/*"
       }
     ]
   }
   ```

### 2. Environment Variables

Add these to your `.env` file:
```env
AWS_ACCESS_KEY_ID=your-aws-access-key-id
AWS_SECRET_ACCESS_KEY=your-aws-secret-access-key
AWS_REGION=us-east-1
AWS_BUCKET_NAME=your-fitness-app-bucket
```

## API Endpoints

### 1. Upload Body Photos (Multipart Form)

**Endpoint**: `POST /api/body-photos/upload`

**Headers**: 
- `Authorization: Bearer <JWT_TOKEN>`

**Body**: `multipart/form-data`
- `frontImage`: Front body photo (file)
- `sideImage`: Side body photo (file)
- `bodyDetailsId`: (optional) Body details ID
- `periodType`: (optional) "onboarding" | "weekly" | "monthly"

**Response**:
```json
{
  "message": "Body photos uploaded successfully",
  "bodyPhotos": {
    "_id": "64f8a1b2c3d4e5f6a7b8c9d0",
    "frontImageUrl": "https://bucket.s3.region.amazonaws.com/body-photos/userId/front-1694789123456.jpg",
    "sideImageUrl": "https://bucket.s3.region.amazonaws.com/body-photos/userId/side-1694789123456.jpg",
    "periodType": "onboarding",
    "recordedAt": "2023-09-15T10:30:00.000Z"
  }
}
```

### 2. Get Upload Signed URL (Direct Upload)

**Endpoint**: `GET /api/body-photos/upload-url`

**Headers**: 
- `Authorization: Bearer <JWT_TOKEN>`

**Query Parameters**:
- `fileName`: Original file name
- `contentType`: MIME type (e.g., "image/jpeg")
- `imageType`: "front" or "side"

**Response**:
```json
{
  "signedUrl": "https://bucket.s3.region.amazonaws.com/body-photos/userId/front-1694789123456.jpg?X-Amz-Algorithm=...",
  "fileName": "body-photos/userId/front-1694789123456.jpg",
  "publicUrl": "https://bucket.s3.region.amazonaws.com/body-photos/userId/front-1694789123456.jpg"
}
```

### 3. Create Body Photos (With URLs)

**Endpoint**: `POST /api/body-photos`

**Headers**: 
- `Authorization: Bearer <JWT_TOKEN>`

**Body**:
```json
{
  "frontImageUrl": "https://bucket.s3.region.amazonaws.com/...",
  "sideImageUrl": "https://bucket.s3.region.amazonaws.com/...",
  "bodyDetailsId": "64f8a1b2c3d4e5f6a7b8c9d0",
  "periodType": "onboarding"
}
```

### 4. List Body Photos

**Endpoint**: `GET /api/body-photos`

**Headers**: 
- `Authorization: Bearer <JWT_TOKEN>`

**Query Parameters**:
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)
- `periodType`: Filter by period type

**Response**:
```json
{
  "bodyPhotos": [
    {
      "_id": "64f8a1b2c3d4e5f6a7b8c9d0",
      "frontImageUrl": "https://bucket.s3.region.amazonaws.com/...",
      "sideImageUrl": "https://bucket.s3.region.amazonaws.com/...",
      "periodType": "onboarding",
      "recordedAt": "2023-09-15T10:30:00.000Z",
      "bodyDetails": {
        "weight": 180,
        "height": 72,
        "bodyFat": 15
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "pages": 1
  }
}
```

### 5. Get Body Photos by ID

**Endpoint**: `GET /api/body-photos/:id`

**Headers**: 
- `Authorization: Bearer <JWT_TOKEN>`

### 6. Update Body Photos

**Endpoint**: `PATCH /api/body-photos/:id`

**Headers**: 
- `Authorization: Bearer <JWT_TOKEN>`

**Body**:
```json
{
  "periodType": "weekly",
  "bodyDetailsId": "64f8a1b2c3d4e5f6a7b8c9d0"
}
```

### 7. Delete Body Photos

**Endpoint**: `DELETE /api/body-photos/:id`

**Headers**: 
- `Authorization: Bearer <JWT_TOKEN>`

**Note**: This will delete both images from S3 and the database record.

## Frontend Integration Examples

### React Native Example

```javascript
// Upload using multipart form
const uploadPhotos = async (frontImage, sideImage) => {
  const formData = new FormData();
  formData.append('frontImage', {
    uri: frontImage.uri,
    type: 'image/jpeg',
    name: 'front.jpg',
  });
  formData.append('sideImage', {
    uri: sideImage.uri,
    type: 'image/jpeg',
    name: 'side.jpg',
  });

  const response = await fetch('http://your-api.com/api/body-photos/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'multipart/form-data',
    },
    body: formData,
  });

  return response.json();
};

// Direct upload using signed URL
const uploadDirect = async (imageUri, imageType) => {
  // Get signed URL
  const urlResponse = await fetch(
    `http://your-api.com/api/body-photos/upload-url?fileName=photo.jpg&contentType=image/jpeg&imageType=${imageType}`,
    {
      headers: { 'Authorization': `Bearer ${token}` },
    }
  );
  const { signedUrl, publicUrl } = await urlResponse.json();

  // Upload directly to S3
  const imageResponse = await fetch(imageUri);
  const imageBlob = await imageResponse.blob();

  await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: imageBlob,
  });

  return publicUrl;
};
```

## File Structure in S3

```
bucket-name/
├── body-photos/
│   ├── userId123/
│   │   ├── front-1694789123456.jpg
│   │   ├── side-1694789123456.jpg
│   │   ├── front-1694875523456.jpg
│   │   └── side-1694875523456.jpg
│   └── userId456/
│       ├── front-1694789123456.jpg
│       └── side-1694789123456.jpg
```

## Security Considerations

1. **File Size Limit**: 10MB per image
2. **File Types**: Only image files are accepted
3. **Authentication**: All endpoints require valid JWT
4. **User Isolation**: Files are organized by user ID
5. **Public Access**: Images are publicly readable but only accessible via API

## Error Handling

Common errors and solutions:

1. **"Only image files are allowed"**: Ensure file MIME type starts with "image/"
2. **"Failed to upload image to S3"**: Check AWS credentials and bucket permissions
3. **"Body photos not found"**: Verify the photo belongs to the authenticated user
4. **"File size too large"**: Images must be under 10MB

## Testing

Use Postman or curl to test endpoints:

```bash
# Test upload URL generation
curl -X GET "http://localhost:3000/api/body-photos/upload-url?fileName=test.jpg&contentType=image/jpeg&imageType=front" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test photo creation with URLs
curl -X POST "http://localhost:3000/api/body-photos" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "frontImageUrl": "https://bucket.s3.region.amazonaws.com/...",
    "sideImageUrl": "https://bucket.s3.region.amazonaws.com/...",
    "periodType": "onboarding"
  }'
```
