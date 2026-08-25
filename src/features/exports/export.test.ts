import { describe, expect, it } from "vitest";
import {
  EXPORT_SCHEMA_VERSION,
  EXPORT_SCHEMA_VERSION_V2,
  projectToExportV1,
  projectToExportV2,
  type CanonicalEntryForExport,
} from "./projection";
import {
  computeChecksum,
  computeChecksumV2,
  serializeJson,
  serializeJsonl,
  serializeJsonV2,
  serializeJsonlV2,
} from "./serializer";

function entry(
  overrides: Partial<CanonicalEntryForExport> = {},
): CanonicalEntryForExport {
  return {
    id: "b0000000-0000-0000-0000-000000000001",
    canonical_word: "سبهللة",
    canonical_dialect_name: "حجازي",
    canonical_msa_synonyms: ["بلا هدف"],
    canonical_explanation: "يُقال عندما يمشي أحدهم بلا وجهة",
    approved_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    examples: [{ sentence: "راح يمشي سبهللة" }],
    ...overrides,
  };
}

describe("projectToExportV1", () => {
  it("sorts records deterministically by id regardless of input order", () => {
    const a = entry({ id: "a" });
    const b = entry({ id: "b" });
    expect(projectToExportV1([b, a]).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("excludes internal fields such as review status or moderation state", () => {
    const [record] = projectToExportV1([entry()]);
    expect(record).not.toHaveProperty("review_status");
    expect(record).not.toHaveProperty("editorial_status");
    expect(record).not.toHaveProperty("abuse_hash");
  });
});

describe("serializer determinism", () => {
  it("produces the same checksum for the same records regardless of order", () => {
    const a = entry({ id: "a" });
    const b = entry({ id: "b" });
    const recordsAB = projectToExportV1([a, b]);
    const recordsBA = projectToExportV1([b, a]);
    expect(computeChecksum(recordsAB)).toBe(computeChecksum(recordsBA));
  });

  it("changes checksum when record content changes", () => {
    const original = projectToExportV1([entry()]);
    const changed = projectToExportV1([entry({ canonical_word: "غير ذلك" })]);
    expect(computeChecksum(original)).not.toBe(computeChecksum(changed));
  });

  it("keeps checksum stable across export runs at different timestamps", () => {
    const records = projectToExportV1([entry()]);
    const first = serializeJson(records, "2026-01-01T00:00:00.000Z");
    const second = serializeJson(records, "2026-06-01T00:00:00.000Z");
    const checksumOf = (s: string) =>
      (JSON.parse(s) as { checksum: string }).checksum;
    expect(checksumOf(first)).toBe(checksumOf(second));
  });

  it("produces one JSON object per line for jsonl", () => {
    const records = projectToExportV1([entry({ id: "a" }), entry({ id: "b" })]);
    const lines = serializeJsonl(records).split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it("locks the v1 contract: a fixed input always produces this exact checksum", () => {
    // Backward-compatibility guard: if this ever needs to change, the v1
    // contract itself changed, which CLAUDE.md/data-model.md say must not
    // happen silently — bump EXPORT_SCHEMA_VERSION_V2 (or a new version)
    // instead of editing this expectation.
    const records = projectToExportV1([entry()]);
    expect(computeChecksum(records)).toBe(
      "04e570a797866a783f924728c141a91d3d28dfaab8e963d1afd47bbad3f07a23",
    );
  });

  it("serializes a canonical entry with no formal-Arabic synonym (now optional) as an empty array, not null/undefined", () => {
    const [record] = projectToExportV1([entry({ canonical_msa_synonyms: [] })]);
    expect(record.msa_synonyms).toEqual([]);
    expect(() =>
      serializeJson([record], "2026-01-01T00:00:00.000Z"),
    ).not.toThrow();
  });

  it("v1 output never contains schema v2's additive fields", () => {
    const [record] = projectToExportV1([
      entry({ main_group_code: "hijazi", main_group_label_ar: "حجازي" }),
    ]);
    expect(record).not.toHaveProperty("main_dialect_group");
    expect(record).not.toHaveProperty("reference_concept_id");
  });
});

describe("projectToExportV2 (additive, provisional)", () => {
  it("includes every v1 field unchanged, plus the additive fields", () => {
    const [v1] = projectToExportV1([entry()]);
    const [v2] = projectToExportV2([entry()]);
    for (const key of Object.keys(v1) as (keyof typeof v1)[]) {
      expect(v2[key]).toEqual(v1[key]);
    }
    expect(v2).toHaveProperty("main_dialect_group");
    expect(v2).toHaveProperty("main_dialect_group_label");
    expect(v2).toHaveProperty("reference_concept_id");
  });

  it("carries the main dialect group and reference concept id when present", () => {
    const [record] = projectToExportV2([
      entry({
        main_group_code: "hijazi",
        main_group_label_ar: "حجازي",
        reference_concept: {
          id: "sad-lonely-word",
          category: "emotions",
          msa_lemma: "وحيد",
        },
      }),
    ]);
    expect(record.main_dialect_group).toBe("hijazi");
    expect(record.main_dialect_group_label).toBe("حجازي");
    expect(record.reference_concept_id).toBe("sad-lonely-word");
  });

  it("uses null (never undefined or a missing key) when a v2 entry has no prompt link or group", () => {
    const [record] = projectToExportV2([entry()]);
    expect(record.main_dialect_group).toBeNull();
    expect(record.main_dialect_group_label).toBeNull();
    expect(record.reference_concept_id).toBeNull();
  });

  it("still excludes internal moderation/admin fields", () => {
    const [record] = projectToExportV2([entry()]);
    expect(record).not.toHaveProperty("review_status");
    expect(record).not.toHaveProperty("editorial_status");
    expect(record).not.toHaveProperty("abuse_hash");
  });

  it("uses schema_version 2 in the envelope, distinct from v1's default", () => {
    const records = projectToExportV2([entry()]);
    const envelope = JSON.parse(
      serializeJsonV2(records, "2026-01-01T00:00:00.000Z"),
    );
    expect(envelope.schema_version).toBe(EXPORT_SCHEMA_VERSION_V2);
    expect(EXPORT_SCHEMA_VERSION_V2).not.toBe(EXPORT_SCHEMA_VERSION);
  });

  it("computes a deterministic checksum independent of record order", () => {
    const a = entry({ id: "a", main_group_code: "hijazi" });
    const b = entry({ id: "b", main_group_code: "najdi" });
    const ab = projectToExportV2([a, b]);
    const ba = projectToExportV2([b, a]);
    expect(computeChecksumV2(ab)).toBe(computeChecksumV2(ba));
  });

  it("changes the checksum when the main dialect group changes", () => {
    const before = projectToExportV2([entry({ main_group_code: "hijazi" })]);
    const after = projectToExportV2([entry({ main_group_code: "najdi" })]);
    expect(computeChecksumV2(before)).not.toBe(computeChecksumV2(after));
  });

  it("produces one JSON object per line for jsonl", () => {
    const records = projectToExportV2([entry({ id: "a" }), entry({ id: "b" })]);
    const lines = serializeJsonlV2(records).split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });
});
