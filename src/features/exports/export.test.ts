import { describe, expect, it } from "vitest";
import { projectToExportV1, type CanonicalEntryForExport } from "./projection";
import { computeChecksum, serializeJson, serializeJsonl } from "./serializer";

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
});
