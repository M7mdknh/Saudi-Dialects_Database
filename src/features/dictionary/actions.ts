"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { toSearchKey } from "@/lib/text/normalize-arabic";
import type {
  MainDialectGroupCode,
  PublicVisibility,
} from "@/lib/supabase/types";

const PAGE_SIZE = 25;

export interface DictionaryEntryRow {
  id: string;
  word: string;
  wordKey: string;
  conceptId: string | null;
  meaning: string | null;
  msaSynonyms: string[];
  register: string | null;
  visibility: PublicVisibility;
  mainGroupCodes: MainDialectGroupCode[];
  localDialectLabels: string[];
  exampleCount: number;
  relatedWords: string[];
  updatedAt: string;
  version: number;
}

export interface ListDictionaryEntriesParams {
  page?: number;
  search?: string;
  mainGroupCode?: MainDialectGroupCode;
  localDialectLabel?: string;
  visibility?: PublicVisibility;
  register?: string;
  missingMeaning?: boolean;
  missingExamples?: boolean;
  missingConcept?: boolean;
  sort?: "word_asc" | "word_desc" | "updated_asc" | "updated_desc";
}

export async function listDictionaryEntries(
  params: ListDictionaryEntriesParams,
) {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const page = params.page ?? 1;

  const { data, error } = await supabase.rpc("dictionary_entries_list", {
    p_search: params.search?.trim() || null,
    p_main_group_code: params.mainGroupCode ?? null,
    p_local_dialect_label: params.localDialectLabel ?? null,
    p_visibility: params.visibility ?? null,
    p_register: params.register ?? null,
    p_missing_meaning: params.missingMeaning ?? null,
    p_missing_examples: params.missingExamples ?? null,
    p_missing_concept: params.missingConcept ?? null,
    p_sort: params.sort ?? "updated_desc",
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  if (error) throw error;

  const rows: DictionaryEntryRow[] = (data ?? []).map((row) => ({
    id: row.id,
    word: row.canonical_word,
    wordKey: row.canonical_word_search_key,
    conceptId: row.concept_id,
    meaning: row.canonical_explanation,
    msaSynonyms: row.canonical_msa_synonyms ?? [],
    register: row.register,
    visibility: row.public_visibility,
    mainGroupCodes: row.main_group_codes ?? [],
    localDialectLabels: row.local_dialect_labels ?? [],
    exampleCount: row.example_count,
    relatedWords: row.related_words ?? [],
    updatedAt: row.updated_at,
    version: row.version,
  }));

  return {
    rows,
    total: data?.[0]?.total_count ?? 0,
    page,
    pageSize: PAGE_SIZE,
  };
}

export interface DictionaryEntryDetail {
  id: string;
  word: string;
  wordKey: string;
  conceptId: string | null;
  meaning: string | null;
  msaSynonyms: string[];
  register: string | null;
  visibility: PublicVisibility;
  relatedWords: string[];
  version: number;
  dialectIds: string[];
  examples: { id: string; sentence: string; position: number }[];
}

export async function getDictionaryEntryDetail(
  entryId: string,
): Promise<DictionaryEntryDetail | null> {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("dictionary_entry_detail", {
    p_entry_id: entryId,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    id: row.id,
    word: row.canonical_word,
    wordKey: row.canonical_word_search_key,
    conceptId: row.concept_id,
    meaning: row.canonical_explanation,
    msaSynonyms: row.canonical_msa_synonyms ?? [],
    register: row.register,
    visibility: row.public_visibility,
    relatedWords: row.related_words ?? [],
    version: row.version,
    dialectIds: row.dialect_ids ?? [],
    examples: row.examples ?? [],
  };
}

export interface UpdateDictionaryEntryInput {
  entryId: string;
  expectedVersion: number;
  word: string;
  meaning: string;
  msaSynonyms: string[];
  dialectIds: string[];
  examples: { id: string | null; sentence: string; position: number }[];
  relatedWords: string[];
  conceptId: string | null;
  register: string | null;
  visibility: PublicVisibility;
}

export interface UpdateDictionaryEntryResult {
  id: string;
  version: number;
  stale: boolean;
}

export async function updateDictionaryEntry(
  input: UpdateDictionaryEntryInput,
): Promise<UpdateDictionaryEntryResult> {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("update_canonical_entry_full", {
      p_actor: admin.userId,
      p_entry_id: input.entryId,
      p_expected_version: input.expectedVersion,
      p_canonical_word: input.word,
      p_canonical_word_search_key: toSearchKey(input.word),
      p_canonical_explanation: input.meaning,
      p_canonical_msa_synonyms: input.msaSynonyms,
      p_dialect_ids: input.dialectIds,
      p_examples: input.examples.map((e) => ({
        id: e.id,
        sentence: e.sentence,
        sentenceSearchKey: toSearchKey(e.sentence),
        position: e.position,
      })),
      p_related_words: input.relatedWords,
      p_concept_id: input.conceptId,
      p_register: input.register,
      p_visibility: input.visibility,
    })
    .single();
  if (error) throw error;
  return { id: data.id, version: data.version, stale: data.stale };
}

export async function bulkSetDictionaryVisibility(
  entryIds: string[],
  visibility: PublicVisibility,
) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("bulk_set_dictionary_visibility", {
    p_actor: admin.userId,
    p_entry_ids: entryIds,
    p_visibility: visibility,
  });
  if (error) throw error;
  return data as number;
}

/**
 * Most recent full-fidelity edit event ('edit_full', written by
 * update_canonical_entry_full — see migration 0028) for this entry, if
 * any. Powers the editor's "تراجع عن آخر تعديل" action; deliberately does
 * NOT match the plain 'edit' action other flows (upsert_canonical_entry)
 * write, since only 'edit_full' events carry the complete dialect-set +
 * example-list snapshot undo_canonical_entry_edit() knows how to restore.
 */
export async function getLastEditEventId(
  entryId: string,
): Promise<string | null> {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("review_events")
    .select("id")
    .eq("canonical_entry_id", entryId)
    .eq("action", "edit_full")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export interface UndoCanonicalEntryEditResult {
  id: string;
  version: number;
  stale: boolean;
}

/** Full-fidelity undo: restores scalar fields, the complete dialect set, and the complete example list (ids/positions/provenance) transactionally, with the same optimistic-concurrency guard as a normal save. */
export async function undoCanonicalEntryEdit(
  eventId: string,
  expectedVersion: number,
): Promise<UndoCanonicalEntryEditResult> {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("undo_canonical_entry_edit", {
      p_actor: admin.userId,
      p_event_id: eventId,
      p_expected_version: expectedVersion,
    })
    .single();
  if (error) throw error;
  return { id: data.id, version: data.version, stale: data.stale };
}

export async function bulkAddDictionaryDialect(
  entryIds: string[],
  dialectId: string,
) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("bulk_add_dictionary_dialect", {
    p_actor: admin.userId,
    p_entry_ids: entryIds,
    p_dialect_id: dialectId,
  });
  if (error) throw error;
  return data as number;
}
