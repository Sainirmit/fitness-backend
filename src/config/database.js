import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

/** Long LLM calls leave Mongo idle; reconnect can exceed the default 10s buffer. */
const MONGOOSE_OPTIONS = {
  bufferTimeoutMS: 120_000,
  serverSelectionTimeoutMS: 30_000,
  maxPoolSize: 10,
};

export const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_OPTIONS);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
};

/**
 * After long awaits (e.g. OpenAI), the driver connection may be stale. Ping and
 * reconnect before writes so operations are not stuck behind Mongoose's buffer
 * until bufferTimeoutMS (see MONGOOSE_OPTIONS).
 */
export async function ensureMongoConnected() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }

  const c = mongoose.connection;

  if (c.readyState === 2) {
    await c.asPromise();
  }

  if (c.readyState === 1) {
    try {
      await c.db.admin().command({ ping: 1 }, { maxTimeMS: 5000 });
      return;
    } catch (err) {
      console.warn('[Mongo] keepalive ping failed, reconnecting:', err?.message);
      await mongoose.disconnect().catch(() => {});
    }
  }

  await mongoose.connect(uri, MONGOOSE_OPTIONS);
}

export const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    console.log('MongoDB Disconnected');
  } catch (error) {
    console.error('Database disconnection error:', error);
  }
};
