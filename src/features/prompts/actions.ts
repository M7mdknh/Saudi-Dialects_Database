"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { toSearchKey } from "@/lib/text/normalize-arabic";
import type { GuidedPromptRecord } from "./types";
import { GUIDED_PROMPT_BATCH_SIZE } from "./constants";

function mapRow(row: {
  id: string;
  category: string;
  category_label_ar: string;
  msa_lemma: string;
  definition_ar: string;
  scenario_ar: string;
  part_of_speech: string;
  answer_form: string;
  priority: number;
  prompt_version: number;
}): GuidedPromptRecord {
  return {
    id: row.id,
    category: row.category,
    categoryLabelAr: row.category_label_ar,
    msaLemma: row.msa_lemma,
    definitionAr: row.definition_ar,
    scenarioAr: row.scenario_ar,
    partOfSpeech: row.part_of_speech,
    answerForm: row.answer_form,
    priority: row.priority,
    promptVersion: row.prompt_version,
  };
}

export interface GuidedPromptPage {
  rows: GuidedPromptRecord[];
  total: number;
}

/**
 * Ordered, paginated guided-prompt read — the homepage's predictable
 * batch-of-6 progression and the /prompts explorer both call this. Only the
 * requested page (never the full ~300-row pool) is ever sent to the
 * browser; ordering is stable (reference_prompts.display_order) so the same
 * offset always returns the same slice.
 */
export async function listReferencePromptsPage(params: {
  offset?: number;
  limit?: number;
  category?: string;
  search?: string;
}): Promise<GuidedPromptPage> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_reference_prompts_page", {
    p_offset: params.offset ?? 0,
    p_limit: params.limit ?? GUIDED_PROMPT_BATCH_SIZE,
    p_category: params.category || null,
    p_search: params.search?.trim() || null,
  });
  if (error) throw error;
  const source = data ?? [];
  return { rows: source.map(mapRow), total: source[0]?.total_count ?? 0 };
}

export interface PromptCategoryCount {
  category: string;
  categoryLabelAr: string;
  count: number;
}

/** Small (<30-row), public-safe category list with counts, for the /prompts filter panel. */
export async function listPromptCategoryCounts(): Promise<
  PromptCategoryCount[]
> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(
    "list_reference_prompt_category_counts",
  );
  if (error) throw error;
  return (data ?? []).map((row) => ({
    category: row.category,
    categoryLabelAr: row.category_label_ar,
    count: row.prompt_count,
  }));
}

// --- Admin prompt management -------------------------------------------

export interface ListReferencePromptsParams {
  page?: number;
  search?: string;
  category?: string;
  status?: "active" | "inactive";
  sortBy?: "priority" | "msa_lemma" | "updated_at";
  sortDir?: "asc" | "desc";
}

const ADMIN_PAGE_SIZE = 25;

export async function listReferencePrompts(params: ListReferencePromptsParams) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const page = params.page ?? 1;
  const from = (page - 1) * ADMIN_PAGE_SIZE;
  const to = from + ADMIN_PAGE_SIZE - 1;

  let query = supabase
    .from("reference_prompts")
    .select("*", { count: "exact" });

  if (params.category) query = query.eq("category", params.category);
  if (params.status === "active") query = query.eq("is_active", true);
  if (params.status === "inactive") query = query.eq("is_active", false);
  if (params.search) {
    const key = toSearchKey(params.search);
    query = query.or(
      `msa_lemma.ilike.%${key}%,definition_ar.ilike.%${key}%,scenario_ar.ilike.%${key}%`,
    );
  }

  const sortBy = params.sortBy ?? "priority";
  const sortDir = params.sortDir ?? "desc";
  query = query.order(sortBy, { ascending: sortDir === "asc" }).range(from, to);

  const [{ data, error, count }, { data: counts }] = await Promise.all([
    query,
    supabase.rpc("reference_prompt_submission_counts", {
      p_actor: admin.userId,
    }),
  ]);
  if (error) throw error;

  const countMap = new Map(
    (counts ?? []).map((c) => [c.reference_prompt_id, c.submission_count]),
  );

  return {
    rows: (data ?? []).map((row) => ({
      ...row,
      submission_count: countMap.get(row.id) ?? 0,
    })),
    total: count ?? 0,
    page,
    pageSize: ADMIN_PAGE_SIZE,
  };
}

/** Distinct categories present in the prompt bank, for the admin filter dropdown. */
export async function listPromptCategories() {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("reference_prompts")
    .select("category, category_label_ar")
    .order("category");
  if (error) throw error;
  const seen = new Map<string, string>();
  for (const row of data ?? []) seen.set(row.category, row.category_label_ar);
  return [...seen.entries()].map(([id, label_ar]) => ({ id, label_ar }));
}

export interface UpsertReferencePromptInput {
  id: string;
  expectedPromptVersion: number;
  category: string;
  categoryLabelAr: string;
  msaLemma: string;
  definitionAr: string;
  scenarioAr: string;
  partOfSpeech: string;
  answerForm: string;
  priority: number;
  isActive: boolean;
}

export async function upsertReferencePrompt(input: UpsertReferencePromptInput) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("upsert_reference_prompt", {
      p_actor: admin.userId,
      p_id: input.id,
      p_expected_prompt_version: input.expectedPromptVersion,
      p_category: input.category,
      p_category_label_ar: input.categoryLabelAr,
      p_msa_lemma: input.msaLemma,
      p_definition_ar: input.definitionAr,
      p_scenario_ar: input.scenarioAr,
      p_part_of_speech: input.partOfSpeech,
      p_answer_form: input.answerForm,
      p_priority: input.priority,
      p_is_active: input.isActive,
    })
    .single();
  if (error) throw error;
  return data as { id: string; prompt_version: number; stale: boolean };
}
