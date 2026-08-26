import { createHash } from "node:crypto";
import {
  EXPORT_SCHEMA_VERSION,
  EXPORT_SCHEMA_VERSION_V2,
  EXPORT_SCHEMA_VERSION_V3,
  type ExportRecordV1,
  type ExportRecordV2,
  type ExportRecordV3,
  type ExportRecordV4,
} from "./projection";

/** Stable key order: explicit field list, not object spread/iteration order. */
function orderedRecord(record: ExportRecordV1) {
  return {
    id: record.id,
    word: record.word,
    dialect: record.dialect,
    msa_synonyms: record.msa_synonyms,
    explanation: record.explanation,
    examples: record.examples,
    approved_at: record.approved_at,
    updated_at: record.updated_at,
  };
}

/** v2: same key order as v1, plus the additive fields at the end. */
function orderedRecordV2(record: ExportRecordV2) {
  return {
    ...orderedRecord(record),
    main_dialect_group: record.main_dialect_group,
    main_dialect_group_label: record.main_dialect_group_label,
    reference_concept_id: record.reference_concept_id,
  };
}

export interface ExportEnvelope {
  schema_version: number;
  exported_at: string;
  record_count: number;
  checksum: string;
  records: ReturnType<typeof orderedRecord>[];
}

/** Checksum covers only the deterministic record content, never the run timestamp, so unchanged data always produces the same checksum. */
export function computeChecksum(records: ExportRecordV1[]): string {
  const canonical = JSON.stringify(records.map(orderedRecord));
  return createHash("sha256").update(canonical).digest("hex");
}

export function serializeJson(
  records: ExportRecordV1[],
  exportedAt: string,
): string {
  const envelope: ExportEnvelope = {
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: exportedAt,
    record_count: records.length,
    checksum: computeChecksum(records),
    records: records.map(orderedRecord),
  };
  return JSON.stringify(envelope, null, 2);
}

export function serializeJsonl(records: ExportRecordV1[]): string {
  return records.map((r) => JSON.stringify(orderedRecord(r))).join("\n");
}

// --- Schema v2 (additive, provisional — see projection.ts) --------------

export function computeChecksumV2(records: ExportRecordV2[]): string {
  const canonical = JSON.stringify(records.map(orderedRecordV2));
  return createHash("sha256").update(canonical).digest("hex");
}

export function serializeJsonV2(
  records: ExportRecordV2[],
  exportedAt: string,
): string {
  const envelope = {
    schema_version: EXPORT_SCHEMA_VERSION_V2,
    exported_at: exportedAt,
    record_count: records.length,
    checksum: computeChecksumV2(records),
    records: records.map(orderedRecordV2),
  };
  return JSON.stringify(envelope, null, 2);
}

export function serializeJsonlV2(records: ExportRecordV2[]): string {
  return records.map((r) => JSON.stringify(orderedRecordV2(r))).join("\n");
}

// --- Schema v3 (recommended per-word dictionary/training format) --------

/** Fixed key order exactly as documented — the external training contract for v3. */
function orderedRecordV3(record: ExportRecordV3) {
  return {
    id: record.id,
    entry_type: record.entry_type,
    word: {
      text: record.word.text,
      variants: record.word.variants,
    },
    dialect: {
      country_code: record.dialect.country_code,
      main_group_code: record.dialect.main_group_code,
      main_group_ar: record.dialect.main_group_ar,
      local_labels: record.dialect.local_labels,
      regions: record.dialect.regions,
    },
    meaning: {
      msa_synonyms: record.meaning.msa_synonyms,
      definition_ar: record.meaning.definition_ar,
      usage_note_ar: record.meaning.usage_note_ar,
    },
    examples: record.examples.map((e) => ({
      id: e.id,
      dialect_text: e.dialect_text,
      msa_paraphrase: e.msa_paraphrase,
      context_ar: e.context_ar,
    })),
    relations: {
      reference_concept_id: record.relations.reference_concept_id,
      synonyms_by_dialect: record.relations.synonyms_by_dialect.map((g) => ({
        main_group_code: g.main_group_code,
        main_group_ar: g.main_group_ar,
        local_labels: g.local_labels,
        words: g.words,
      })),
    },
    tags: {
      part_of_speech: record.tags.part_of_speech,
      semantic_categories: record.tags.semantic_categories,
      register: record.tags.register,
      usage_tags: record.tags.usage_tags,
    },
    provenance: {
      source_type: record.provenance.source_type,
      source_count: record.provenance.source_count,
      review_status: record.provenance.review_status,
      reviewed_at: record.provenance.reviewed_at,
    },
  };
}

/** Checksum covers only the deterministic per-word records array, never `exported_at`. */
export function computeChecksumV3(records: ExportRecordV3[]): string {
  const canonical = JSON.stringify(records.map(orderedRecordV3));
  return createHash("sha256").update(canonical).digest("hex");
}

export function serializeJsonV3(
  records: ExportRecordV3[],
  exportedAt: string,
): string {
  const envelope = {
    schema_version: EXPORT_SCHEMA_VERSION_V3,
    dataset: "saudi_dialects_dictionary",
    exported_at: exportedAt,
    record_count: records.length,
    checksum: computeChecksumV3(records),
    records: records.map(orderedRecordV3),
  };
  return JSON.stringify(envelope, null, 2);
}

/** One complete per-word record per line — never the envelope. Same projection, same order as JSON. */
export function serializeJsonlV3(records: ExportRecordV3[]): string {
  return records.map((r) => JSON.stringify(orderedRecordV3(r))).join("\n");
}

// --- Schema v4 (simplified clean-dictionary/training format) ------------
//
// The download body is a plain top-level array — no schema_version,
// dataset, exported_at, record_count, or checksum wrapper. Exact key order,
// exactly the documented keys, UTF-8 with no ASCII escaping.

function orderedRecordV4(record: ExportRecordV4) {
  return {
    word: record.word,
    word_key: record.word_key,
    concept_id: record.concept_id,
    meaning: record.meaning,
    msa_synonyms: record.msa_synonyms,
    dialects: record.dialects,
    local_dialects: record.local_dialects,
    examples: record.examples,
    related_words: record.related_words,
    register: record.register,
  };
}

/** Checksum covers the same deterministic array the download body contains — kept internal (never in the download itself), for the admin UI/export log only. */
export function computeChecksumV4(records: ExportRecordV4[]): string {
  const canonical = JSON.stringify(records.map(orderedRecordV4));
  return createHash("sha256").update(canonical).digest("hex");
}

/** Plain top-level array, 2-space indented, no envelope fields. */
export function serializeJsonV4(records: ExportRecordV4[]): string {
  return JSON.stringify(records.map(orderedRecordV4), null, 2);
}

export function serializeJsonlV4(records: ExportRecordV4[]): string {
  return records.map((r) => JSON.stringify(orderedRecordV4(r))).join("\n");
}

// --- ALLaM-compatible training JSONL -------------------------------------

export const ALLAM_DIALECT_TAG: Record<string, string> = {
  hijazi: "HIJAZI",
  najdi: "NAJDI",
  eastern: "EASTERN",
  northern: "NORTHERN",
  southern: "SOUTHERN",
};

export interface AllamRow {
  instruction: string;
  response: string;
  dialect: string;
}

/**
 * Deterministic training rows from already-cleaned v4 records — never a
 * fabricated meaning or a generated example. Grouped consecutively by
 * canonical entry (all rows for one word/dialect appear together) so a
 * future split step can assign a whole group to one split without
 * cross-referencing anything else, preventing the same word/sense from
 * leaking across train/dev/test.
 */
export function generateAllamRows(records: ExportRecordV4[]): AllamRow[] {
  const rows: AllamRow[] = [];
  for (const record of records) {
    for (const code of record.dialects) {
      const tag = ALLAM_DIALECT_TAG[code];
      if (!tag) continue;
      const dialectTagPrefix = `<DIALECT=${tag}>`;

      for (const example of record.examples) {
        rows.push({
          instruction: `${dialectTagPrefix} استخدم كلمة «${record.word}» في جملة طبيعية.`,
          response: example,
          dialect: tag,
        });
      }

      if (record.meaning) {
        rows.push({
          instruction: `${dialectTagPrefix} وش معنى كلمة «${record.word}»؟`,
          response: record.meaning,
          dialect: tag,
        });
      }
    }
  }
  return rows;
}

export function serializeAllamJsonl(rows: AllamRow[]): string {
  return rows
    .map((r) =>
      JSON.stringify({
        instruction: r.instruction,
        response: r.response,
        dialect: r.dialect,
      }),
    )
    .join("\n");
}
