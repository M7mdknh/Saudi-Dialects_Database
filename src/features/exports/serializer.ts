import { createHash } from "node:crypto";
import {
  EXPORT_SCHEMA_VERSION,
  EXPORT_SCHEMA_VERSION_V2,
  type ExportRecordV1,
  type ExportRecordV2,
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
