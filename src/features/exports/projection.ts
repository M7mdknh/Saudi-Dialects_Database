/**
 * Pure export projection. Kept independent of table/column names so the
 * external training JSON contract (not yet finalized — see data-model.md)
 * can change without touching the database schema. Only approved canonical
 * records are eligible; callers must pre-filter for editorial_status =
 * 'approved' before calling this.
 *
 * Schema v1 is the original, unchanged contract — kept byte-for-byte
 * backward compatible. Schema v2 is additive and provisional: it adds the
 * main Saudi dialect group and, where a canonical entry originated from a
 * guided reference prompt, the concept it answers. Callers opt into v2
 * explicitly (see /api/admin/exports?schemaVersion=2); v1 stays the default.
 */
export const EXPORT_SCHEMA_VERSION = 1;
export const EXPORT_SCHEMA_VERSION_V2 = 2;

export interface CanonicalEntryForExport {
  id: string;
  canonical_word: string;
  canonical_dialect_name: string;
  canonical_msa_synonyms: string[];
  canonical_explanation: string | null;
  approved_at: string | null;
  updated_at: string;
  examples: { sentence: string }[];
  main_group_code?: string | null;
  main_group_label_ar?: string | null;
  reference_concept?: {
    id: string;
    category: string;
    msa_lemma: string;
  } | null;
}

export interface ExportRecordV1 {
  id: string;
  word: string;
  dialect: string;
  msa_synonyms: string[];
  explanation: string | null;
  examples: string[];
  approved_at: string | null;
  updated_at: string;
}

export interface ExportRecordV2 extends ExportRecordV1 {
  main_dialect_group: string | null;
  main_dialect_group_label: string | null;
  reference_concept_id: string | null;
}

/** Deterministic ordering: stable, independent of insertion order. */
export function sortForExport(
  entries: CanonicalEntryForExport[],
): CanonicalEntryForExport[] {
  return [...entries].sort((a, b) => a.id.localeCompare(b.id));
}

/** Maps internal canonical records to the versioned, provisional external shape. Excludes all internal moderation/admin/abuse fields by construction. */
export function projectToExportV1(
  entries: CanonicalEntryForExport[],
): ExportRecordV1[] {
  return sortForExport(entries).map((entry) => ({
    id: entry.id,
    word: entry.canonical_word,
    dialect: entry.canonical_dialect_name,
    msa_synonyms: entry.canonical_msa_synonyms,
    explanation: entry.canonical_explanation,
    examples: entry.examples.map((e) => e.sentence),
    approved_at: entry.approved_at,
    updated_at: entry.updated_at,
  }));
}

/** Additive v2 projection: everything in v1, plus main dialect group and reference-concept linkage where present. Never expands to internal/moderation fields. */
export function projectToExportV2(
  entries: CanonicalEntryForExport[],
): ExportRecordV2[] {
  return sortForExport(entries).map((entry) => ({
    id: entry.id,
    word: entry.canonical_word,
    dialect: entry.canonical_dialect_name,
    msa_synonyms: entry.canonical_msa_synonyms,
    explanation: entry.canonical_explanation,
    examples: entry.examples.map((e) => e.sentence),
    approved_at: entry.approved_at,
    updated_at: entry.updated_at,
    main_dialect_group: entry.main_group_code ?? null,
    main_dialect_group_label: entry.main_group_label_ar ?? null,
    reference_concept_id: entry.reference_concept?.id ?? null,
  }));
}
