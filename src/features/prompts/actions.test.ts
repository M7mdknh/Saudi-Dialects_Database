import { describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ rpc: rpcMock })),
}));

const { getGuidedPrompts } = await import("./actions");

function row(id: string, category: string) {
  return {
    id,
    category,
    category_label_ar: category,
    msa_lemma: id,
    definition_ar: `تعريف ${id}`,
    scenario_ar: `سيناريو ${id}`,
    part_of_speech: "noun",
    answer_form: "word_or_phrase",
    priority: 90,
    prompt_version: 1,
  };
}

describe("getGuidedPrompts", () => {
  it("returns only prompts from the active-prompts RPC (never more than what the DB marked active)", async () => {
    const activeRows = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) =>
      row(id, id),
    );
    rpcMock.mockResolvedValueOnce({ data: activeRows, error: null });

    const result = await getGuidedPrompts([]);

    expect(rpcMock).toHaveBeenCalledWith("list_active_reference_prompts");
    expect(result).toHaveLength(6);
    const activeIds = new Set(activeRows.map((r) => r.id));
    expect(result.every((p) => activeIds.has(p.id))).toBe(true);
  });

  it("never sends the whole active pool to the caller, only the display count", async () => {
    const activeRows = Array.from({ length: 60 }, (_, i) =>
      row(`p${i}`, `cat${i % 10}`),
    );
    rpcMock.mockResolvedValueOnce({ data: activeRows, error: null });

    const result = await getGuidedPrompts([]);
    expect(result.length).toBeLessThan(activeRows.length);
    expect(result).toHaveLength(6);
  });

  it("propagates RPC errors instead of silently returning an empty set", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: new Error("boom") });
    await expect(getGuidedPrompts([])).rejects.toThrow();
  });

  it("propagates a missing-table error (undeployed migration) instead of an empty set", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'relation "reference_prompts" does not exist',
        code: "42P01",
      },
    });
    await expect(getGuidedPrompts([])).rejects.toBeTruthy();
  });

  it("propagates an RLS-denial error instead of an empty set", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: "permission denied for function list_active_reference_prompts",
        code: "42501",
      },
    });
    await expect(getGuidedPrompts([])).rejects.toBeTruthy();
  });

  it("returns a genuine empty array (not a throw) when the RPC succeeds with no active rows", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    await expect(getGuidedPrompts([])).resolves.toEqual([]);
  });
});
