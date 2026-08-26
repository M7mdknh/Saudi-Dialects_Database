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
 * guided reference prompt, the concept it answers. Schema v3 is the
 * recommended per-word dictionary/training format: a richer, explicitly
 * versioned, deterministic shape. v1 and v2 remain untouched by v3.
 */
export const EXPORT_SCHEMA_VERSION = 1;
export const EXPORT_SCHEMA_VERSION_V2 = 2;
export const EXPORT_SCHEMA_VERSION_V3 = 3;
export const EXPORT_SCHEMA_VERSION_V4 = 4;

export const ALLOWED_REGISTERS = [
  "neutral",
  "informal",
  "slang",
  "offensive",
  "taboo",
  "archaic",
] as const;
export type Register = (typeof ALLOWED_REGISTERS)[number];

export const MAIN_GROUP_ORDER = [
  "hijazi",
  "najdi",
  "eastern",
  "northern",
  "southern",
] as const;

export const MAIN_GROUP_LABELS_AR: Record<string, string> = {
  hijazi: "حجازي",
  najdi: "نجدي",
  eastern: "شرقاوي",
  northern: "شمالي",
  southern: "جنوبي",
};

export interface CanonicalEntryForExport {
  id: string;
  canonical_word: string;
  canonical_word_search_key: string;
  canonical_dialect_name: string;
  canonical_msa_synonyms: string[];
  canonical_explanation: string | null;
  approved_at: string | null;
  updated_at: string;
  examples: { id: string; sentence: string }[];
  main_group_code?: string | null;
  main_group_label_ar?: string | null;
  local_labels?: string[];
  reference_concept?: {
    id: string;
    category: string;
    category_label_ar?: string;
    msa_lemma: string;
  } | null;
  source_count?: number;
  concept_id?: string | null;
  register?: string | null;
  related_words?: string[];
  /** v4 only: the full multi-dialect set (a word can belong to more than one main group and/or local dialect via the dictionary editor). Falls back to `main_group_code`/`local_labels` when absent or empty. */
  main_group_codes?: string[];
  local_dialect_labels?: string[];
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

// --- Schema v3: per-word dictionary/training format --------------------

export interface ExportExampleV3 {
  id: string;
  dialect_text: string;
  msa_paraphrase: string | null;
  context_ar: string | null;
}

export interface SynonymGroupV3 {
  main_group_code: string;
  main_group_ar: string;
  local_labels: string[];
  words: string[];
}

export interface ExportRecordV3 {
  id: string;
  entry_type: "word";
  word: { text: string; variants: string[] };
  dialect: {
    country_code: "SA";
    main_group_code: string | null;
    main_group_ar: string | null;
    local_labels: string[];
    regions: string[];
  };
  meaning: {
    msa_synonyms: string[];
    definition_ar: string | null;
    usage_note_ar: string | null;
  };
  examples: ExportExampleV3[];
  relations: {
    reference_concept_id: string | null;
    synonyms_by_dialect: SynonymGroupV3[];
  };
  tags: {
    part_of_speech: string | null;
    semantic_categories: string[];
    register: string | null;
    usage_tags: string[];
  };
  provenance: {
    source_type: "crowdsourced";
    source_count: number;
    review_status: "approved";
    reviewed_at: string | null;
  };
}

function dedupeSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "ar"));
}

/**
 * Cross-dialect synonym groups for one entry: other approved canonical
 * entries sharing the same verified reference concept — never a loose
 * text-similarity guess (data-model.md: recommendations aren't identity).
 * `entries` is the full eligible set so this can be computed in pure
 * application code rather than a second database round-trip.
 */
function synonymsByDialectFor(
  entry: CanonicalEntryForExport,
  entries: CanonicalEntryForExport[],
): SynonymGroupV3[] {
  const conceptId = entry.reference_concept?.id;
  if (!conceptId) return [];

  const groups = new Map<
    string,
    { localLabels: Set<string>; words: Set<string> }
  >();

  for (const other of entries) {
    if (other.id === entry.id) continue;
    if (other.reference_concept?.id !== conceptId) continue;
    const code = other.main_group_code;
    if (!code) continue;
    const group = groups.get(code) ?? {
      localLabels: new Set<string>(),
      words: new Set<string>(),
    };
    for (const label of other.local_labels ?? []) group.localLabels.add(label);
    group.words.add(other.canonical_word);
    groups.set(code, group);
  }

  return MAIN_GROUP_ORDER.filter((code) => groups.has(code)).map((code) => {
    const group = groups.get(code)!;
    return {
      main_group_code: code,
      main_group_ar: MAIN_GROUP_LABELS_AR[code],
      local_labels: dedupeSorted([...group.localLabels]),
      words: dedupeSorted([...group.words]),
    };
  });
}

export function projectToExportV3(
  entries: CanonicalEntryForExport[],
): ExportRecordV3[] {
  const sorted = sortForExport(entries);
  return sorted.map((entry) => ({
    id: entry.id,
    entry_type: "word",
    word: { text: entry.canonical_word, variants: [] },
    dialect: {
      country_code: "SA",
      main_group_code: entry.main_group_code ?? null,
      main_group_ar: entry.main_group_label_ar ?? null,
      local_labels: dedupeSorted(entry.local_labels ?? []),
      regions: [],
    },
    meaning: {
      msa_synonyms: dedupeSorted(entry.canonical_msa_synonyms ?? []),
      definition_ar: entry.canonical_explanation,
      usage_note_ar: null,
    },
    examples: entry.examples.map((e) => ({
      id: e.id,
      dialect_text: e.sentence,
      msa_paraphrase: null,
      context_ar: null,
    })),
    relations: {
      reference_concept_id: entry.reference_concept?.id ?? null,
      synonyms_by_dialect: synonymsByDialectFor(entry, entries),
    },
    tags: {
      part_of_speech: null,
      semantic_categories: entry.reference_concept?.category_label_ar
        ? [entry.reference_concept.category_label_ar]
        : [],
      register: null,
      usage_tags: [],
    },
    provenance: {
      source_type: "crowdsourced",
      source_count: entry.source_count ?? 1,
      review_status: "approved",
      reviewed_at: entry.approved_at,
    },
  }));
}

// --- Schema v4: simplified clean-dictionary/training format -------------
//
// A plain top-level array (no envelope) of exactly the documented keys, in
// the documented order. Never invents meaning, concept links, or register —
// each is `null`/`[]` unless an admin has already recorded real data.

export interface ExportRecordV4 {
  word: string;
  word_key: string;
  concept_id: string | null;
  meaning: string | null;
  msa_synonyms: string[];
  dialects: string[];
  local_dialects: string[];
  examples: string[];
  related_words: string[];
  register: string | null;
}

export interface ExportV4Exclusion {
  id: string;
  word: string;
  reason: "no_valid_examples";
}

export interface ExportV4Result {
  records: ExportRecordV4[];
  excluded: ExportV4Exclusion[];
}

/** Trim, drop blanks, and deduplicate while preserving first-occurrence order. */
function cleanStringList(values: string[] | undefined | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values ?? []) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function isValidRegister(value: string | null | undefined): value is Register {
  return !!value && (ALLOWED_REGISTERS as readonly string[]).includes(value);
}

/** Deterministic v4 ordering: word_key, then dialects, then stable id. */
function sortForExportV4(
  entries: CanonicalEntryForExport[],
): CanonicalEntryForExport[] {
  return [...entries].sort((a, b) => {
    const byKey = a.canonical_word_search_key.localeCompare(
      b.canonical_word_search_key,
    );
    if (byKey !== 0) return byKey;
    const byDialect = (a.main_group_code ?? "").localeCompare(
      b.main_group_code ?? "",
    );
    if (byDialect !== 0) return byDialect;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Pure v4 projection. Filters out any entry with no valid (non-blank,
 * deduplicated) example — such entries are reported in `excluded` rather
 * than silently included with an empty examples array, per the product
 * rule that a training record needs at least one real example.
 */
export function projectToExportV4(
  entries: CanonicalEntryForExport[],
): ExportV4Result {
  const sorted = sortForExportV4(entries);
  const records: ExportRecordV4[] = [];
  const excluded: ExportV4Exclusion[] = [];

  for (const entry of sorted) {
    const examples = cleanStringList(entry.examples.map((e) => e.sentence));
    if (examples.length === 0) {
      excluded.push({
        id: entry.id,
        word: entry.canonical_word,
        reason: "no_valid_examples",
      });
      continue;
    }

    const meaning = entry.canonical_explanation?.trim() || null;
    const conceptId =
      entry.concept_id?.trim() || entry.reference_concept?.id || null;

    records.push({
      word: entry.canonical_word,
      word_key: entry.canonical_word_search_key,
      concept_id: conceptId,
      meaning,
      msa_synonyms: cleanStringList(entry.canonical_msa_synonyms),
      dialects:
        entry.main_group_codes && entry.main_group_codes.length > 0
          ? cleanStringList(entry.main_group_codes)
          : entry.main_group_code
            ? [entry.main_group_code]
            : [],
      local_dialects:
        entry.local_dialect_labels && entry.local_dialect_labels.length > 0
          ? cleanStringList(entry.local_dialect_labels)
          : cleanStringList(entry.local_labels),
      examples,
      related_words: cleanStringList(entry.related_words).filter(
        (w) => w !== entry.canonical_word,
      ),
      register: isValidRegister(entry.register) ? entry.register : null,
    });
  }

  return { records, excluded };
}
