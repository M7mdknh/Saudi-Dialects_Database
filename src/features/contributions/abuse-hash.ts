import "server-only";
import { createHmac } from "node:crypto";

const HASH_TTL_MS = 24 * 60 * 60 * 1000; // 24h, short-lived correlation window only.

/**
 * Derives a short-lived keyed hash from a request identifier (IP) for
 * rate-limiting/abuse correlation. Never store the raw IP — see
 * CLAUDE.md "Security and privacy".
 */
export function hashRequestIdentifier(
  identifier: string,
  secret: string,
): string {
  return createHmac("sha256", secret).update(identifier).digest("hex");
}

export function abuseHashExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + HASH_TTL_MS);
}

export function getRequestIdentifier(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
