import mongoose from 'mongoose';
import './models/user.model';
import './models/onboarding-auth.model';
import './models/otp.model';
import './models/doc.model';
import './models/onboarding-data.model';

let connected = false;

export async function connectDB(): Promise<void> {
  if (connected) return;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set in environment.');

  await mongoose.connect(uri);
  connected = true;
  console.log('[DB] Connected to MongoDB');
}
