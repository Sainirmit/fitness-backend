import admin from 'firebase-admin';

let app;

/**
 * Returns the initialized Firebase Admin instance (lazy singleton).
 * Called at request time so the server can still boot even if Firebase
 * credentials haven't been set yet in development.
 */
export const getFirebaseAdmin = () => {
  if (!app) {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (
      !process.env.FIREBASE_PROJECT_ID ||
      !process.env.FIREBASE_CLIENT_EMAIL ||
      !privateKey
    ) {
      throw new Error(
        'Missing Firebase credentials. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in your .env file.'
      );
    }

    app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });
  }

  return admin;
};
