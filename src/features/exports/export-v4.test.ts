import { describe, expect, it } from "vitest";
import {
  EXPORT_SCHEMA_VERSION_V4,
  projectToExportV4,
  type CanonicalEntryForExport,
} from "./projection";
import {
  ALLAM_DIALECT_TAG,
  computeChecksumV4,
  generateAllamRows,
  serializeAllamJsonl,
  serializeJsonlV4,
  serializeJsonV4,
} from "./serializer";

function entry(
  overrides: Partial<CanonicalEntryForExport> = {},
): CanonicalEntryForExport {
  return {
    id: "b0000000-0000-0000-0000-000000000001",
    canonical_word: "اتمرمط",
    canonical_word_search_key: "اتمرمط",
    canonical_dialect_name: "حجازي",
    canonical_msa_synonyms: ["عانى", "أُرهق"],
    canonical_explanation: "تعب وعانى بسبب كثرة العمل أو التنقل",
    approved_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    examples: [
      {
        id: "e0000000-0000-0000-0000-000000000001",
        sentence:
          "خالد خرج من الدوام على البنك وبعدها راح النادي، يعني اتمرمط كثير اليوم",
      },
    ],
    main_group_code: "hijazi",
    main_group_label_ar: "حجازي",
    local_labels: ["مديني"],
    related_words: ["اتبهذل"],
    register: "informal",
    concept_id: null,
    ...overrides,
  };
}

describe("projectToExportV4 — Arabic logical Unicode order (not reversed)", () => {
  // Regression for a suspected bidi-reversal bug: verifies the *serialized*
  // string equals the exact literal in logical (not visual/reversed) order,
  // and additionally inspects raw code points so a reversal can't hide
  // behind string-equality quirks.
  const [record] = projectToExportV4([entry()]).records;

  it("word is the exact logical string, not its visual/reversed form", () => {
    expect(record.word).toBe("اتمرمط");
    expect(record.word).not.toBe("طمرمتا");
  });

  it("local_dialects preserves logical order", () => {
    expect(record.local_dialects).toEqual(["مديني"]);
    expect(record.local_dialects).not.toEqual(["ينيدم"]);
  });

  it("examples[0] contains the logically-ordered opening phrase", () => {
    expect(record.examples[0]).toContain("خالد خرج من الدوام");
  });

  it("main dialect label building block is never reversed (يزاجح would be the reversal of حجازي)", () => {
    expect(record.dialects).toEqual(["hijazi"]);
    const label = MAIN_GROUP_LABELS_AR_LOCAL["hijazi"];
    expect(label).toBe("حجازي");
    expect(label).not.toBe("يزاجح");
  });

  it("code points of the serialized word match the literal's code points in the same order", () => {
    const serialized = JSON.parse(serializeJsonV4([record]))[0].word as string;
    const expectedCodepoints = [...("اتمرمط" as string)].map((c) =>
      c.codePointAt(0),
    );
    const actualCodepoints = [...serialized].map((c) => c.codePointAt(0));
    expect(actualCodepoints).toEqual(expectedCodepoints);
    // Explicitly rule out the reversed sequence.
    expect(actualCodepoints).not.toEqual([...expectedCodepoints].reverse());
  });

  it("raw UTF-8 bytes on the wire are in logical order, not reversed", () => {
    const body = serializeJsonV4([record]);
    const bytes = Buffer.from(body, "utf-8");
    // اتمرمط in UTF-8: ا=D8 A7, ت=D8 AA, م=D9 85, ر=D8 B1, م=D9 85, ط=D8 B7
    const expectedByteSeq = Buffer.from([
      0xd8, 0xa7, 0xd8, 0xaa, 0xd9, 0x85, 0xd8, 0xb1, 0xd9, 0x85, 0xd8, 0xb7,
    ]);
    expect(bytes.includes(expectedByteSeq)).toBe(true);
    const reversedByteSeq = Buffer.from([...expectedByteSeq].reverse());
    expect(bytes.includes(reversedByteSeq)).toBe(false);
  });
});

const MAIN_GROUP_LABELS_AR_LOCAL: Record<string, string> = {
  hijazi: "حجازي",
  najdi: "نجدي",
  eastern: "شرقاوي",
  northern: "شمالي",
  southern: "جنوبي",
};

describe("projectToExportV4 — shape and key order", () => {
  it("produces exactly the documented keys in the documented order", () => {
    const [record] = projectToExportV4([entry()]).records;
    expect(Object.keys(record)).toEqual([
      "word",
      "word_key",
      "concept_id",
      "meaning",
      "msa_synonyms",
      "dialects",
      "local_dialects",
      "examples",
      "related_words",
      "register",
    ]);
  });

  it("matches the documented sample record exactly", () => {
    const [record] = projectToExportV4([entry()]).records;
    expect(record).toEqual({
      word: "اتمرمط",
      word_key: "اتمرمط",
      concept_id: null,
      meaning: "تعب وعانى بسبب كثرة العمل أو التنقل",
      msa_synonyms: ["عانى", "أُرهق"],
      dialects: ["hijazi"],
      local_dialects: ["مديني"],
      examples: [
        "خالد خرج من الدوام على البنك وبعدها راح النادي، يعني اتمرمط كثير اليوم",
      ],
      related_words: ["اتبهذل"],
      register: "informal",
    });
  });

  it("never includes forbidden internal fields", () => {
    const [record] = projectToExportV4([entry()]).records;
    expect(record).not.toHaveProperty("id");
    expect(record).not.toHaveProperty("approved_at");
    expect(record).not.toHaveProperty("updated_at");
    expect(record).not.toHaveProperty("public_visibility");
    expect(record).not.toHaveProperty("editorial_status");
    expect(record).not.toHaveProperty("country_code");
  });
});

describe("projectToExportV4 — null vs [] rules", () => {
  it("meaning is null, not a fabricated value, when no explanation exists", () => {
    const [record] = projectToExportV4([
      entry({ canonical_explanation: null }),
    ]).records;
    expect(record.meaning).toBeNull();
    // never substitutes an MSA synonym as the meaning
    expect(record.msa_synonyms).not.toContain(record.meaning);
  });

  it("msa_synonyms is [] (never null) when there are none", () => {
    const [record] = projectToExportV4([
      entry({ canonical_msa_synonyms: [] }),
    ]).records;
    expect(record.msa_synonyms).toEqual([]);
  });

  it("local_dialects is [] when there is no local label", () => {
    const [record] = projectToExportV4([entry({ local_labels: [] })]).records;
    expect(record.local_dialects).toEqual([]);
  });

  it("related_words is [] when there are none", () => {
    const [record] = projectToExportV4([entry({ related_words: [] })]).records;
    expect(record.related_words).toEqual([]);
  });

  it("register is null when unset or not a recognized value", () => {
    expect(
      projectToExportV4([entry({ register: null })]).records[0].register,
    ).toBeNull();
    expect(
      projectToExportV4([entry({ register: "dialect" })]).records[0].register,
    ).toBeNull();
  });

  it("concept_id is null when not set and there is no reference concept", () => {
    const [record] = projectToExportV4([
      entry({ concept_id: null, reference_concept: null }),
    ]).records;
    expect(record.concept_id).toBeNull();
  });

  it("concept_id falls back to an existing verified reference-concept link, never invents one", () => {
    const [record] = projectToExportV4([
      entry({
        concept_id: null,
        reference_concept: {
          id: "sad-lonely-word",
          category: "emotions",
          msa_lemma: "حزين",
        },
      }),
    ]).records;
    expect(record.concept_id).toBe("sad-lonely-word");
  });

  it("an explicit admin-set concept_id wins over the reference-concept link", () => {
    const [record] = projectToExportV4([
      entry({
        concept_id: "manual-concept-7",
        reference_concept: {
          id: "sad-lonely-word",
          category: "emotions",
          msa_lemma: "حزين",
        },
      }),
    ]).records;
    expect(record.concept_id).toBe("manual-concept-7");
  });
});

describe("projectToExportV4 — examples and related-word rules", () => {
  it("preserves the administrator's curated example order", () => {
    const [record] = projectToExportV4([
      entry({
        examples: [
          { id: "e1", sentence: "الجملة الأولى" },
          { id: "e2", sentence: "الجملة الثانية" },
          { id: "e3", sentence: "الجملة الثالثة" },
        ],
      }),
    ]).records;
    expect(record.examples).toEqual([
      "الجملة الأولى",
      "الجملة الثانية",
      "الجملة الثالثة",
    ]);
  });

  it("trims blanks and removes exact duplicate sentences", () => {
    const [record] = projectToExportV4([
      entry({
        examples: [
          { id: "e1", sentence: "  نفس الجملة  " },
          { id: "e2", sentence: "" },
          { id: "e3", sentence: "نفس الجملة" },
          { id: "e4", sentence: "جملة مختلفة" },
        ],
      }),
    ]).records;
    expect(record.examples).toEqual(["نفس الجملة", "جملة مختلفة"]);
  });

  it("excludes a record with no valid example and reports it", () => {
    const { records, excluded } = projectToExportV4([
      entry({ id: "no-examples", examples: [{ id: "e1", sentence: "   " }] }),
    ]);
    expect(records).toEqual([]);
    expect(excluded).toEqual([
      { id: "no-examples", word: "اتمرمط", reason: "no_valid_examples" },
    ]);
  });

  it("deduplicates related words and excludes the entry's own word", () => {
    const [record] = projectToExportV4([
      entry({ related_words: ["اتبهذل", "اتبهذل", "اتمرمط", "  "] }),
    ]).records;
    expect(record.related_words).toEqual(["اتبهذل"]);
  });

  it("deduplicates and trims MSA synonyms", () => {
    const [record] = projectToExportV4([
      entry({ canonical_msa_synonyms: ["عانى", " عانى ", "أُرهق", ""] }),
    ]).records;
    expect(record.msa_synonyms).toEqual(["عانى", "أُرهق"]);
  });
});

describe("projectToExportV4 — dialects and word_key", () => {
  it("uses the stable main-group code, not the Arabic label", () => {
    const [record] = projectToExportV4([
      entry({ main_group_code: "najdi", main_group_label_ar: "نجدي" }),
    ]).records;
    expect(record.dialects).toEqual(["najdi"]);
  });

  it("word_key is the Arabic-safe normalized search key, never collapsing ة/ه or ى/ي", () => {
    const [record] = projectToExportV4([
      entry({
        canonical_word: "مدرسة",
        canonical_word_search_key: "مدرسة",
      }),
    ]).records;
    expect(record.word_key).toBe("مدرسة");
    expect(record.word_key).not.toBe("مدرسه");
  });

  it("uses the plural multi-dialect set from the dictionary editor when present, over the singular legacy field", () => {
    const [record] = projectToExportV4([
      entry({
        main_group_code: "hijazi",
        main_group_codes: ["hijazi", "najdi"],
        local_labels: ["مديني"],
        local_dialect_labels: ["مديني", "بريدي"],
      }),
    ]).records;
    expect(record.dialects).toEqual(["hijazi", "najdi"]);
    expect(record.local_dialects).toEqual(["مديني", "بريدي"]);
  });

  it("falls back to the singular legacy field when the plural set is absent or empty (entry never touched by the multi-dialect editor)", () => {
    const [record] = projectToExportV4([
      entry({
        main_group_code: "eastern",
        main_group_codes: [],
        local_labels: ["دمامي"],
        local_dialect_labels: [],
      }),
    ]).records;
    expect(record.dialects).toEqual(["eastern"]);
    expect(record.local_dialects).toEqual(["دمامي"]);
  });
});

describe("projectToExportV4 — deterministic ordering and checksum", () => {
  it("sorts by word_key, then dialect, then id — independent of input order", () => {
    const a = entry({
      id: "a",
      canonical_word_search_key: "ب",
      main_group_code: "najdi",
    });
    const b = entry({
      id: "b",
      canonical_word_search_key: "أ",
      main_group_code: "hijazi",
    });
    const c = entry({
      id: "c",
      canonical_word_search_key: "أ",
      main_group_code: "eastern",
    });
    const { records: r1 } = projectToExportV4([a, b, c]);
    const { records: r2 } = projectToExportV4([c, a, b]);
    expect(r1.map((r) => r.word_key + ":" + r.dialects[0])).toEqual([
      "أ:eastern",
      "أ:hijazi",
      "ب:najdi",
    ]);
    expect(r1).toEqual(r2);
  });

  it("produces the same checksum for the same records regardless of input order", () => {
    const a = entry({ id: "a" });
    const b = entry({ id: "b", canonical_word: "كلمة أخرى" });
    const { records: r1 } = projectToExportV4([a, b]);
    const { records: r2 } = projectToExportV4([b, a]);
    expect(computeChecksumV4(r1)).toBe(computeChecksumV4(r2));
  });

  it("changes checksum when a field changes", () => {
    const base = projectToExportV4([entry()]).records;
    const changed = projectToExportV4([
      entry({ canonical_explanation: "معنى مختلف" }),
    ]).records;
    expect(computeChecksumV4(base)).not.toBe(computeChecksumV4(changed));
  });
});

describe("v4 serialization — plain top-level array, no envelope", () => {
  it("serializeJsonV4 is a plain array, not wrapped in schema_version/records/etc.", () => {
    const { records } = projectToExportV4([entry()]);
    const body = serializeJsonV4(records);
    const parsed = JSON.parse(body);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).not.toHaveProperty("schema_version");
    expect(parsed).not.toHaveProperty("records");
    expect(parsed).not.toHaveProperty("checksum");
    expect(parsed).not.toHaveProperty("exported_at");
    expect(parsed).not.toHaveProperty("record_count");
  });

  it("serializeJsonlV4 emits one complete record per line", () => {
    const { records } = projectToExportV4([
      entry({ id: "a" }),
      entry({ id: "b", canonical_word: "كلمة ثانية" }),
    ]);
    const lines = serializeJsonlV4(records).split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("does not ASCII-escape Arabic text", () => {
    const { records } = projectToExportV4([entry()]);
    const body = serializeJsonV4(records);
    expect(body).toContain("اتمرمط");
    expect(body).not.toContain("\\u");
  });

  it("EXPORT_SCHEMA_VERSION_V4 is 4", () => {
    expect(EXPORT_SCHEMA_VERSION_V4).toBe(4);
  });
});

describe("v4 regression: 'all dialects' never inherits a stale single-dialect filter", () => {
  it("projection includes every represented dialect when no dialect filter narrows the input set", () => {
    const entries = [
      entry({ id: "1", main_group_code: "hijazi" }),
      entry({ id: "2", main_group_code: "najdi" }),
      entry({ id: "3", main_group_code: "eastern" }),
      entry({ id: "4", main_group_code: "northern" }),
      entry({ id: "5", main_group_code: "southern" }),
    ];
    const { records } = projectToExportV4(entries);
    const dialectsSeen = new Set(records.flatMap((r) => r.dialects));
    expect(dialectsSeen).toEqual(
      new Set(["hijazi", "najdi", "eastern", "northern", "southern"]),
    );
    // The historical bug symptom: every record silently ending up "southern".
    expect(records.every((r) => r.dialects[0] === "southern")).toBe(false);
  });
});

describe("ALLaM training JSONL", () => {
  it("maps all five dialect codes to their training tags", () => {
    expect(ALLAM_DIALECT_TAG).toEqual({
      hijazi: "HIJAZI",
      najdi: "NAJDI",
      eastern: "EASTERN",
      northern: "NORTHERN",
      southern: "SOUTHERN",
    });
  });

  it("generates one usage row per valid example plus one meaning row when meaning exists", () => {
    const { records } = projectToExportV4([
      entry({
        examples: [
          { id: "e1", sentence: "جملة أولى" },
          { id: "e2", sentence: "جملة ثانية" },
        ],
      }),
    ]);
    const rows = generateAllamRows(records);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      instruction: "<DIALECT=HIJAZI> استخدم كلمة «اتمرمط» في جملة طبيعية.",
      response: "جملة أولى",
      dialect: "HIJAZI",
    });
    expect(rows[1].response).toBe("جملة ثانية");
    expect(rows[2]).toEqual({
      instruction: "<DIALECT=HIJAZI> وش معنى كلمة «اتمرمط»؟",
      response: "تعب وعانى بسبب كثرة العمل أو التنقل",
      dialect: "HIJAZI",
    });
  });

  it("never generates a meaning row when meaning is missing", () => {
    const { records } = projectToExportV4([
      entry({ canonical_explanation: null }),
    ]);
    const rows = generateAllamRows(records);
    expect(rows).toHaveLength(1);
    expect(rows.some((r) => r.instruction.includes("وش معنى"))).toBe(false);
  });

  it("never fabricates a meaning from an MSA synonym", () => {
    const { records } = projectToExportV4([
      entry({
        canonical_explanation: null,
        canonical_msa_synonyms: ["عانى"],
      }),
    ]);
    const rows = generateAllamRows(records);
    expect(rows.some((r) => r.response === "عانى")).toBe(false);
  });

  it("supports all five dialect labels, not just two", () => {
    const entries = (
      ["hijazi", "najdi", "eastern", "northern", "southern"] as const
    ).map((code, i) =>
      entry({ id: `e${i}`, main_group_code: code, canonical_word: `كلمة${i}` }),
    );
    const { records } = projectToExportV4(entries);
    const rows = generateAllamRows(records);
    const tagsSeen = new Set(rows.map((r) => r.dialect));
    expect(tagsSeen).toEqual(
      new Set(["HIJAZI", "NAJDI", "EASTERN", "NORTHERN", "SOUTHERN"]),
    );
  });

  it("keeps all rows from the same canonical entry consecutive, preventing split leakage", () => {
    const entries = [
      entry({ id: "1", canonical_word: "كلمة1" }),
      entry({ id: "2", canonical_word: "كلمة2" }),
    ];
    const { records } = projectToExportV4(entries);
    const rows = generateAllamRows(records);
    const wordSequence = rows.map((r) =>
      r.instruction.includes("كلمة1") ? "1" : "2",
    );
    // grouped, not interleaved
    let switches = 0;
    for (let i = 1; i < wordSequence.length; i++) {
      if (wordSequence[i] !== wordSequence[i - 1]) switches++;
    }
    expect(switches).toBeLessThanOrEqual(1);
  });

  it("serializes to one JSON object per line with exactly instruction/response/dialect", () => {
    const { records } = projectToExportV4([entry()]);
    const rows = generateAllamRows(records);
    const body = serializeAllamJsonl(rows);
    const lines = body.split("\n");
    expect(lines).toHaveLength(rows.length);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(Object.keys(parsed).sort()).toEqual([
        "dialect",
        "instruction",
        "response",
      ]);
    }
  });
});
