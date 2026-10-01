import { Schema, model, Document } from 'mongoose';

export interface IRateLimitHit extends Document {
  key: string;
  hits: number;
  resetAt: Date;
}

const RateLimitHitSchema = new Schema<IRateLimitHit>(
  {
    key: { type: String, required: true, unique: true },
    hits: { type: Number, required: true, default: 0 },
    resetAt: { type: Date, required: true },
  },
  { versionKey: false },
);

RateLimitHitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitHit = model<IRateLimitHit>('RateLimitHit', RateLimitHitSchema);
