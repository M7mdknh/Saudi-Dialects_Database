import { describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ rpc: rpcMock })),
}));

const { listReferencePromptsPage, listPromptCategoryCounts } =
  await import("./actions");

function row(id: string, category: string, totalCount: number) {
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
    display_order: 1,
    total_count: totalCount,
  };
}

describe("listReferencePromptsPage", () => {
  it("requests the ordered, paginated RPC with the given offset/limit/category/search", async () => {
    rpcMock.mockResolvedValueOnce({ data: [row("a", "cat1", 1)], error: null });

    await listReferencePromptsPage({
      offset: 12,
      limit: 6,
      category: "cat1",
      search: "شيء",
    });

    expect(rpcMock).toHaveBeenCalledWith("list_reference_prompts_page", {
      p_offset: 12,
      p_limit: 6,
      p_category: "cat1",
      p_search: "شيء",
    });
  });

  it("returns the page rows and the true total from the RPC, never the whole pool", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => row(`p${i}`, "cat", 300));
    rpcMock.mockResolvedValueOnce({ data: rows, error: null });

    const page = await listReferencePromptsPage({ offset: 0, limit: 6 });
    expect(page.rows).toHaveLength(6);
    expect(page.total).toBe(300);
  });

  it("returns a genuine empty page (not a throw) when the RPC succeeds with no rows", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const page = await listReferencePromptsPage({ offset: 0, limit: 6 });
    expect(page).toEqual({ rows: [], total: 0 });
  });

  it("propagates RPC errors instead of silently returning an empty page", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: new Error("boom") });
    await expect(listReferencePromptsPage({})).rejects.toThrow();
  });

  it("propagates a missing-table/RLS-denial-style error instead of an empty page", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied", code: "42501" },
    });
    await expect(listReferencePromptsPage({})).rejects.toBeTruthy();
  });
});

describe("listPromptCategoryCounts", () => {
  it("maps category counts from the RPC", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          category: "emotions",
          category_label_ar: "المشاعر",
          prompt_count: 12,
        },
      ],
      error: null,
    });
    const result = await listPromptCategoryCounts();
    expect(result).toEqual([
      { category: "emotions", categoryLabelAr: "المشاعر", count: 12 },
    ]);
  });

  it("propagates errors instead of returning an empty list", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: new Error("boom") });
    await expect(listPromptCategoryCounts()).rejects.toThrow();
  });
});
