import type { ClientRateLimitInfo, IncrementResponse, Options, Store } from 'express-rate-limit';
import { RateLimitHit } from '../db/models/rate-limit-hit.model';

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000;
}

export class MongoRateLimitStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  private windowMs = 60_000;

  constructor(prefix: string) {
    this.prefix = `${prefix}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private key(key: string): string {
    return this.prefix + key;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const doc = await RateLimitHit.findOne({ key: this.key(key), resetAt: { $gt: new Date() } }).lean();
    return doc ? { totalHits: doc.hits, resetTime: doc.resetAt } : undefined;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const now = new Date();
    const freshReset = new Date(now.getTime() + this.windowMs);
    const active = { $gt: ['$resetAt', now] };

    const run = () => RateLimitHit.findOneAndUpdate(
      { key: this.key(key) },
      [{
        $set: {
          hits: { $cond: [active, { $add: ['$hits', 1] }, 1] },
          resetAt: { $cond: [active, '$resetAt', freshReset] },
        },
      }],
      { upsert: true, returnDocument: 'after', updatePipeline: true, lean: true },
    );

    let doc;
    try {
      doc = await run();
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      doc = await run();
    }

    return { totalHits: doc?.hits ?? 1, resetTime: doc?.resetAt ?? freshReset };
  }

  async decrement(key: string): Promise<void> {
    await RateLimitHit.updateOne(
      { key: this.key(key), hits: { $gt: 0 }, resetAt: { $gt: new Date() } },
      { $inc: { hits: -1 } },
    );
  }

  async resetKey(key: string): Promise<void> {
    await RateLimitHit.deleteOne({ key: this.key(key) });
  }

  async resetAll(): Promise<void> {
    await RateLimitHit.deleteMany({ key: { $regex: `^${this.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } });
  }
}
