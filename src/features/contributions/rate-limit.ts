import "server-only";

/**
 * Minimal in-memory fixed-window limiter. Works for a single Node process;
 * it is an integration point, not a production guarantee — swap for a
 * shared store (e.g. Upstash Redis, Vercel KV) before scaling past one
 * instance, keyed by the same privacy-preserving abuse hash used here.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 5;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

export function isRateLimited(key: string, now: number = Date.now()): boolean {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_WINDOW;
}
