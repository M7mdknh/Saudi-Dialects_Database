import { describe, expect, it } from "vitest";
import {
  EXPORT_SCHEMA_VERSION,
  EXPORT_SCHEMA_VERSION_V2,
  EXPORT_SCHEMA_VERSION_V3,
  projectToExportV1,
  projectToExportV2,
  projectToExportV3,
  type CanonicalEntryForExport,
} from "./projection";
import {
  computeChecksum,
  computeChecksumV2,
  computeChecksumV3,
  serializeJson,
  serializeJsonl,
  serializeJsonV2,
  serializeJsonlV2,
  serializeJsonV3,
  serializeJsonlV3,
} from "./serializer";

function entry(
  overrides: Partial<CanonicalEntryForExport> = {},
): CanonicalEntryForExport {
  return {
    id: "b0000000-0000-0000-0000-000000000001",
    canonical_word: "سبهللة",
    canonical_word_search_key: "سبهللة",
    canonical_dialect_name: "حجازي",
    canonical_msa_synonyms: ["بلا هدف"],
    canonical_explanation: "يُقال عندما يمشي أحدهم بلا وجهة",
    approved_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    examples: [
      {
        id: "e0000000-0000-0000-0000-000000000001",
        sentence: "راح يمشي سبهللة",
      },
    ],
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

describe("projectToExportV3 (recommended per-word dictionary format)", () => {
  it("projects a complete approved record with an MSA synonym", () => {
    const [record] = projectToExportV3([
      entry({
        main_group_code: "hijazi",
        main_group_label_ar: "حجازي",
        local_labels: ["جداوي"],
        source_count: 2,
      }),
    ]);
    expect(record.id).toBe("b0000000-0000-0000-0000-000000000001");
    expect(record.entry_type).toBe("word");
    expect(record.word).toEqual({ text: "سبهللة", variants: [] });
    expect(record.dialect).toEqual({
      country_code: "SA",
      main_group_code: "hijazi",
      main_group_ar: "حجازي",
      local_labels: ["جداوي"],
      regions: [],
    });
    expect(record.meaning.msa_synonyms).toEqual(["بلا هدف"]);
    expect(record.meaning.definition_ar).toBe(
      "يُقال عندما يمشي أحدهم بلا وجهة",
    );
    expect(record.examples).toEqual([
      {
        id: "e0000000-0000-0000-0000-000000000001",
        dialect_text: "راح يمشي سبهللة",
        msa_paraphrase: null,
        context_ar: null,
      },
    ]);
    expect(record.provenance).toEqual({
      source_type: "crowdsourced",
      source_count: 2,
      review_status: "approved",
      reviewed_at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("an approved record with no MSA synonym still appears, as an empty array — never excluded", () => {
    const [record] = projectToExportV3([entry({ canonical_msa_synonyms: [] })]);
    expect(record).toBeDefined();
    expect(record.meaning.msa_synonyms).toEqual([]);
  });

  it("uses null for an absent optional definition, never excluding the word", () => {
    const [record] = projectToExportV3([
      entry({ canonical_explanation: null }),
    ]);
    expect(record.meaning.definition_ar).toBeNull();
    expect(record.meaning.usage_note_ar).toBeNull();
  });

  it("multiple examples stay on the one canonical record — never duplicated into separate records", () => {
    const [record] = projectToExportV3([
      entry({
        examples: [
          { id: "e1", sentence: "خلص الاكل" },
          { id: "e2", sentence: "خلصت كلامي" },
          { id: "e3", sentence: "كل اللي عندي خلصته" },
        ],
      }),
    ]);
    const records = projectToExportV3([entry()]);
    expect(records).toHaveLength(1);
    expect(record.examples).toHaveLength(3);
    expect(record.examples.map((e) => e.dialect_text)).toEqual([
      "خلص الاكل",
      "خلصت كلامي",
      "كل اللي عندي خلصته",
    ]);
  });

  it("deduplicates and sorts multiple approved local labels", () => {
    const [record] = projectToExportV3([
      entry({ local_labels: ["مكي", "جداوي", "جداوي"] }),
    ]);
    expect(record.dialect.local_labels).toEqual(["جداوي", "مكي"]);
  });

  it("groups cross-dialect synonyms sharing a verified reference concept", () => {
    const hijazi = entry({
      id: "a",
      canonical_word: "سبهللة",
      main_group_code: "hijazi",
      main_group_label_ar: "حجازي",
      reference_concept: { id: "messy", category: "states", msa_lemma: "فوضى" },
    });
    const najdi = entry({
      id: "b",
      canonical_word: "مبعثرة",
      main_group_code: "najdi",
      main_group_label_ar: "نجدي",
      local_labels: ["قصيمي"],
      reference_concept: { id: "messy", category: "states", msa_lemma: "فوضى" },
    });
    const [hijaziRecord] = projectToExportV3([hijazi, najdi]).filter(
      (r) => r.id === "a",
    );
    expect(hijaziRecord.relations.synonyms_by_dialect).toEqual([
      {
        main_group_code: "najdi",
        main_group_ar: "نجدي",
        local_labels: ["قصيمي"],
        words: ["مبعثرة"],
      },
    ]);
  });

  it("a record with no verified concept link has no synonym groups and a null reference_concept_id", () => {
    const [record] = projectToExportV3([entry({ reference_concept: null })]);
    expect(record.relations.reference_concept_id).toBeNull();
    expect(record.relations.synonyms_by_dialect).toEqual([]);
  });

  it("does not invent a synonym group from mere text similarity — only a shared reference concept", () => {
    const a = entry({ id: "a", canonical_word: "سبهللة" });
    const b = entry({ id: "b", canonical_word: "سبهللة" }); // same word, no concept link
    const [recordA] = projectToExportV3([a, b]).filter((r) => r.id === "a");
    expect(recordA.relations.synonyms_by_dialect).toEqual([]);
  });

  it("envelope uses schema_version 3 and the documented dataset name", () => {
    const records = projectToExportV3([entry()]);
    const envelope = JSON.parse(
      serializeJsonV3(records, "2026-01-01T00:00:00.000Z"),
    );
    expect(envelope.schema_version).toBe(EXPORT_SCHEMA_VERSION_V3);
    expect(envelope.dataset).toBe("saudi_dialects_dictionary");
    expect(envelope.record_count).toBe(1);
  });

  it("produces one complete per-word JSON object per JSONL line, never the envelope", () => {
    const records = projectToExportV3([entry({ id: "a" }), entry({ id: "b" })]);
    const lines = serializeJsonlV3(records).split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed).not.toHaveProperty("schema_version");
      expect(parsed).toHaveProperty("entry_type");
    }
  });

  it("JSON and JSONL select and order the same records", () => {
    const records = projectToExportV3([entry({ id: "b" }), entry({ id: "a" })]);
    const jsonIds = (
      JSON.parse(serializeJsonV3(records, "2026-01-01T00:00:00.000Z"))
        .records as { id: string }[]
    ).map((r) => r.id);
    const jsonlIds = serializeJsonlV3(records)
      .split("\n")
      .map((line) => (JSON.parse(line) as { id: string }).id);
    expect(jsonIds).toEqual(jsonlIds);
  });

  it("repeated exports of unchanged records produce the same checksum, independent of exported_at", () => {
    const records = projectToExportV3([entry()]);
    const first = computeChecksumV3(records);
    const second = computeChecksumV3(records);
    expect(first).toBe(second);
    const envelope1 = JSON.parse(
      serializeJsonV3(records, "2026-01-01T00:00:00.000Z"),
    );
    const envelope2 = JSON.parse(
      serializeJsonV3(records, "2027-01-01T00:00:00.000Z"),
    );
    expect(envelope1.checksum).toBe(envelope2.checksum);
  });

  it("changes the checksum when record content changes", () => {
    const before = projectToExportV3([entry()]);
    const after = projectToExportV3([entry({ canonical_word: "غير ذلك" })]);
    expect(computeChecksumV3(before)).not.toBe(computeChecksumV3(after));
  });

  it("computes a deterministic checksum independent of input record order", () => {
    const a = entry({ id: "a" });
    const b = entry({ id: "b" });
    expect(computeChecksumV3(projectToExportV3([a, b]))).toBe(
      computeChecksumV3(projectToExportV3([b, a])),
    );
  });

  it("never exposes internal admin/abuse/security fields (review_status is intentionally present, per the v3 contract, as the single fixed value 'approved')", () => {
    const [record] = projectToExportV3([entry()]);
    const flat = JSON.stringify(record);
    expect(flat).not.toContain("abuse_hash");
    expect(flat).not.toContain("idempotency");
    expect(flat).not.toContain("turnstile");
    expect(flat).not.toContain("editorial_status");
    expect(record.provenance.review_status).toBe("approved");
  });

  it("uses review_status 'approved' for every exported record, since only approved entries are ever eligible", () => {
    const [record] = projectToExportV3([entry()]);
    expect(record.provenance.review_status).toBe("approved");
  });
});
