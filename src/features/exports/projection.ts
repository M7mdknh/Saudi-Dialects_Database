/**
 * Pure export projection. Kept independent of table/column names so the
 * external training JSON contract (not yet finalized — see data-model.md)
 * can change without touching the database schema. Only approved canonical
 * records are eligible; callers must pre-filter for editorial_status =
 * 'approved' before calling this.
 */
export const EXPORT_SCHEMA_VERSION = 1;

export interface CanonicalEntryForExport {
  id: string;
  canonical_word: string;
  canonical_dialect_name: string;
  canonical_msa_synonyms: string[];
  canonical_explanation: string | null;
  approved_at: string | null;
  updated_at: string;
  examples: { sentence: string }[];
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
