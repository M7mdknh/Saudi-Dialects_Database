import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_PROMPT_COUNT,
  validateGuidedPromptsDataset,
} from "./guided-prompts-validation.mjs";

const dataDir = path.resolve(process.cwd(), "data");

async function loadJson(name) {
  return JSON.parse(await readFile(path.join(dataDir, name), "utf8"));
}

describe("guided prompts dataset", () => {
  it("passes schema validation against the authoritative dataset and catalog", async () => {
    const dataset = await loadJson("guided-prompts.sa.ar.json");
    const catalog = await loadJson("guided-prompts.sa.catalog.json");
    expect(validateGuidedPromptsDataset(dataset, catalog)).toEqual([]);
  });

  it("contains exactly the expected 300 prompts", async () => {
    const dataset = await loadJson("guided-prompts.sa.ar.json");
    expect(dataset.prompts).toHaveLength(EXPECTED_PROMPT_COUNT);
  });

  it("has unique stable ids", async () => {
    const dataset = await loadJson("guided-prompts.sa.ar.json");
    const ids = dataset.prompts.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("flags a duplicate id", () => {
    const dataset = {
      category_labels_ar: { a: "أ" },
      prompts: Array.from({ length: 300 }, (_, i) => ({
        id: i === 1 ? "x-0" : `x-${i}`,
        msa_lemma: "كلمة",
        definition_ar: "تعريف عربي",
        scenario_ar: "سيناريو عربي",
        category: "a",
        part_of_speech: "noun",
        answer_form: "word_or_phrase",
        priority: 90,
        prompt_version: 1,
        is_active: true,
      })),
    };
    const errors = validateGuidedPromptsDataset(dataset);
    expect(errors.some((e) => e.includes("duplicate stable id"))).toBe(true);
  });

  it("flags a missing required field", () => {
    const dataset = {
      category_labels_ar: { a: "أ" },
      prompts: [
        {
          id: "x",
          msa_lemma: "",
          definition_ar: "تعريف",
          scenario_ar: "سيناريو",
          category: "a",
          part_of_speech: "noun",
          answer_form: "word_or_phrase",
          priority: 90,
          prompt_version: 1,
          is_active: true,
        },
      ],
    };
    const errors = validateGuidedPromptsDataset(dataset);
    expect(
      errors.some((e) =>
        e.includes('missing or empty required field "msa_lemma"'),
      ),
    ).toBe(true);
  });

  it("flags an unknown category", () => {
    const dataset = {
      category_labels_ar: { a: "أ" },
      prompts: [
        {
          id: "x",
          msa_lemma: "كلمة",
          definition_ar: "تعريف",
          scenario_ar: "سيناريو",
          category: "unknown",
          part_of_speech: "noun",
          answer_form: "word_or_phrase",
          priority: 90,
          prompt_version: 1,
          is_active: true,
        },
      ],
    };
    const errors = validateGuidedPromptsDataset(dataset);
    expect(
      errors.some((e) => e.includes("has no entry in category_labels_ar")),
    ).toBe(true);
  });

  it("flags non-Arabic content in an Arabic field", () => {
    const dataset = {
      category_labels_ar: { a: "أ" },
      prompts: [
        {
          id: "x",
          msa_lemma: "كلمة",
          definition_ar: "just english text",
          scenario_ar: "سيناريو",
          category: "a",
          part_of_speech: "noun",
          answer_form: "word_or_phrase",
          priority: 90,
          prompt_version: 1,
          is_active: true,
        },
      ],
    };
    const errors = validateGuidedPromptsDataset(dataset);
    expect(
      errors.some((e) => e.includes("contains no Arabic characters")),
    ).toBe(true);
  });

  it("flags dataset/catalog drift", () => {
    const dataset = {
      category_labels_ar: { food: "الطعام" },
      prompts: [
        {
          id: "rice",
          msa_lemma: "أرز",
          definition_ar: "تعريف قديم",
          scenario_ar: "سيناريو",
          category: "food",
          part_of_speech: "noun",
          answer_form: "word_or_phrase",
          priority: 90,
          prompt_version: 1,
          is_active: true,
        },
      ],
    };
    const catalog = {
      categories: [
        {
          id: "food",
          label_ar: "الطعام",
          prompts: [
            { id: "rice", msa_lemma: "أرز", definition_ar: "تعريف جديد" },
          ],
        },
      ],
    };
    const errors = validateGuidedPromptsDataset(dataset, catalog);
    expect(
      errors.some((e) => e.includes("dataset is out of sync with the catalog")),
    ).toBe(true);
  });
});
