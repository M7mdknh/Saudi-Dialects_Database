import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import {
  serverSubmissionBatchSchema,
  submissionBatchSchema,
} from "@/features/contributions/schema";
import { mapZodIssuesToFieldErrors } from "@/features/contributions/field-errors";
import { createSubmissionBatch } from "@/features/contributions/submission-service";
import { verifyTurnstileToken } from "@/features/contributions/turnstile-verify";
import { isRateLimited } from "@/features/contributions/rate-limit";
import {
  abuseHashExpiry,
  getRequestIdentifier,
  hashRequestIdentifier,
} from "@/features/contributions/abuse-hash";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 200_000; // ~200KB comfortably covers 50 word cards.

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ code: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  let env: ReturnType<typeof getServerEnv>;
  try {
    env = getServerEnv();
  } catch (error) {
    // A misconfigured/missing environment variable must not crash the route
    // handler (which would return an HTML error page the client can't
    // parse as JSON, collapsing into an opaque "unexpected error"). Fail
    // clean with a stable JSON error instead.
    console.error("submission_env_invalid", {
      message: (error as Error).message,
    });
    return NextResponse.json({ code: "SERVER_ERROR" }, { status: 500 });
  }

  const identifier = getRequestIdentifier(request);
  const abuseHash = hashRequestIdentifier(identifier, env.ABUSE_HASH_SECRET);

  if (isRateLimited(abuseHash)) {
    return NextResponse.json({ code: "RATE_LIMITED" }, { status: 429 });
  }

  let rawBody: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES) {
      return NextResponse.json({ code: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    }
    rawBody = JSON.parse(text);
  } catch {
    return NextResponse.json({ code: "VALIDATION_FAILED" }, { status: 400 });
  }

  const requireTurnstile = Boolean(env.TURNSTILE_SECRET_KEY);
  const schema = requireTurnstile
    ? serverSubmissionBatchSchema
    : submissionBatchSchema;
  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    const words = Array.isArray((rawBody as { words?: unknown })?.words)
      ? (rawBody as { words: unknown[] }).words
      : [];
    return NextResponse.json(
      {
        code: "VALIDATION_FAILED",
        fieldErrors: mapZodIssuesToFieldErrors(parsed.error, words),
      },
      { status: 400 },
    );
  }

  if (requireTurnstile && env.TURNSTILE_SECRET_KEY) {
    const verified = await verifyTurnstileToken(
      parsed.data.turnstileToken as string,
      env.TURNSTILE_SECRET_KEY,
      identifier,
    );
    if (!verified) {
      return NextResponse.json({ code: "TURNSTILE_FAILED" }, { status: 400 });
    }
  }

  try {
    const result = await createSubmissionBatch(
      parsed.data,
      abuseHash,
      abuseHashExpiry().toISOString(),
    );
    return NextResponse.json(
      {
        ok: true,
        batchId: result.batchId,
        acceptedEntryCount: result.acceptedEntryCount,
        leaderboardUpdates: result.leaderboardUpdates,
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    console.error("submission_insert_failed", {
      message: (error as Error).message,
      code: (error as { code?: string }).code,
    });
    return NextResponse.json(
      { code: isDbUnavailableError(error) ? "DB_UNAVAILABLE" : "SERVER_ERROR" },
      { status: 500 },
    );
  }
}

/** PostgREST/pg connection-exception error classes (SQLSTATE class "08") and network-level fetch failures — distinct from a genuine constraint/logic error in the submission itself. */
function isDbUnavailableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (typeof code === "string" && code.startsWith("08")) return true;
  const message = (error as { message?: string } | null)?.message ?? "";
  return /fetch failed|ECONNREFUSED|ETIMEDOUT|network/i.test(message);
}
