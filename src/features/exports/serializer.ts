import { createHash } from "node:crypto";
import { EXPORT_SCHEMA_VERSION, type ExportRecordV1 } from "./projection";

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
