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

/**
 * Playwright runs the `mobile` and `desktop` projects against one shared
 * `next build && next start` process (Next.js sets `NODE_ENV=production` for
 * that regardless), so every e2e submission collapses onto the same
 * identifier (no forwarded-for header locally) and shares this in-memory
 * bucket — the full suite alone exceeds the real 5-per-10-minutes budget.
 * `E2E_RATE_LIMIT_BYPASS` is set only in `playwright.config.ts`'s
 * `webServer.env`, a local child process — never by Vercel itself, which is
 * why `VERCEL` (auto-injected only on actual Vercel infrastructure) is the
 * guard here instead of `NODE_ENV`: a stray copy of the bypass var can never
 * disable rate-limiting on a real deployment.
 */
function isBypassedForE2E(): boolean {
  return !process.env.VERCEL && process.env.E2E_RATE_LIMIT_BYPASS === "1";
}

export function isRateLimited(key: string, now: number = Date.now()): boolean {
  if (isBypassedForE2E()) return false;
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_WINDOW;
}
