import type { SubmissionBatchInput } from "./schema";

export interface LeaderboardUpdate {
  mainGroupCode: string;
  submissionCount: number;
}

export interface SubmitBatchSuccess {
  ok: true;
  batchId: string;
  acceptedEntryCount: number;
  leaderboardUpdates: LeaderboardUpdate[];
}

export interface SubmitBatchFailure {
  ok: false;
  code: string;
  fieldErrors?: Record<string, Record<string, string>>;
}

export type SubmitBatchResult = SubmitBatchSuccess | SubmitBatchFailure;

export async function submitBatch(
  payload: SubmissionBatchInput,
): Promise<SubmitBatchResult> {
  let response: Response;
  try {
    response = await fetch("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, code: "SERVER_ERROR" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: response.ok ? "SERVER_ERROR" : "SERVER_ERROR" };
  }

  if (response.ok && isSuccessBody(body)) {
    return {
      ok: true,
      batchId: body.batchId,
      acceptedEntryCount: body.acceptedEntryCount ?? 0,
      leaderboardUpdates: body.leaderboardUpdates ?? [],
    };
  }

  if (isFailureBody(body)) {
    return { ok: false, code: body.code, fieldErrors: body.fieldErrors };
  }

  return { ok: false, code: "SERVER_ERROR" };
}

function isSuccessBody(body: unknown): body is {
  batchId: string;
  acceptedEntryCount?: number;
  leaderboardUpdates?: LeaderboardUpdate[];
} {
  return (
    typeof body === "object" &&
    body !== null &&
    "batchId" in body &&
    typeof (body as { batchId: unknown }).batchId === "string"
  );
}

function isFailureBody(body: unknown): body is {
  code: string;
  fieldErrors?: Record<string, Record<string, string>>;
} {
  return typeof body === "object" && body !== null && "code" in body;
}
