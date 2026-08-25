import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock }),
}));

beforeEach(() => {
  rpcMock.mockReset();
});

const { createSubmissionBatch } = await import("./submission-service");

function baseWord(overrides: Partial<Parameters<typeof word>[0]> = {}) {
  return word(overrides);
}
function word(overrides: Record<string, unknown> = {}) {
  return {
    clientId: "c1",
    word: "سبهللة",
    dialect: "حجازي",
    dialectId: "11111111-1111-4111-8111-111111111111",
    provisionalMainGroupCode: null,
    msaSynonym: "",
    explanation: "",
    examples: [{ sentence: "مثال" }],
    referencePromptId: null,
    referencePromptSnapshot: null,
    ...overrides,
  };
}

describe("createSubmissionBatch", () => {
  it("reports acceptedEntryCount = word count and maps leaderboardUpdates on a fresh insert", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          batch_id: "b1",
          created: true,
          affected_groups: [{ main_group_code: "hijazi", submission_count: 5 }],
        },
      ],
      error: null,
    });

    const result = await createSubmissionBatch(
      {
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        consentVersion: "v1",
        words: [baseWord()],
      },
      null,
      null,
    );

    expect(result.created).toBe(true);
    expect(result.acceptedEntryCount).toBe(1);
    expect(result.leaderboardUpdates).toEqual([
      { mainGroupCode: "hijazi", submissionCount: 5 },
    ]);
  });

  it("reports acceptedEntryCount = 0 and no leaderboard updates on an idempotent replay", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ batch_id: "b1", created: false, affected_groups: [] }],
      error: null,
    });

    const result = await createSubmissionBatch(
      {
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        consentVersion: "v1",
        words: [baseWord(), baseWord({ clientId: "c2" })],
      },
      null,
      null,
    );

    expect(result.created).toBe(false);
    expect(result.acceptedEntryCount).toBe(0);
    expect(result.leaderboardUpdates).toEqual([]);
  });

  it("passes dialectId and provisionalMainGroupCode through to the RPC for each word", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ batch_id: "b1", created: true, affected_groups: [] }],
      error: null,
    });

    await createSubmissionBatch(
      {
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        consentVersion: "v1",
        words: [
          baseWord({ dialectId: null, provisionalMainGroupCode: "najdi" }),
        ],
      },
      null,
      null,
    );

    const call = rpcMock.mock.calls[0][1] as {
      p_words: Record<string, unknown>[];
    };
    expect(call.p_words[0].dialectId).toBeNull();
    expect(call.p_words[0].provisionalMainGroupCode).toBe("najdi");
  });

  it("reports acceptedEntryCount = 5 for a five-word batch", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          batch_id: "b1",
          created: true,
          affected_groups: [{ main_group_code: "hijazi", submission_count: 5 }],
        },
      ],
      error: null,
    });

    const words = Array.from({ length: 5 }, (_, i) =>
      baseWord({ clientId: `c${i}` }),
    );
    const result = await createSubmissionBatch(
      {
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        consentVersion: "v1",
        words,
      },
      null,
      null,
    );
    expect(result.acceptedEntryCount).toBe(5);
  });
});
