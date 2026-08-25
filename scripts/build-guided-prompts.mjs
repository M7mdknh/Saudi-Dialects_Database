import { readFile, writeFile } from "node:fs/promises";
import { validateGuidedPromptsDataset } from "./guided-prompts-validation.mjs";

// Resolve every data path relative to the repository root (this file lives
// in scripts/, the data lives in data/), regardless of the caller's cwd.
const dataDir = new URL("../data/", import.meta.url);
const baseUrl = new URL("guided-prompts.ar.json", dataDir);
const catalogUrl = new URL("guided-prompts.sa.catalog.json", dataDir);
const outputUrl = new URL("guided-prompts.sa.ar.json", dataDir);

async function readJsonIfExists(url) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const catalog = await readJsonIfExists(catalogUrl);
  if (!catalog) {
    throw new Error(`Missing catalog source: ${catalogUrl.pathname}`);
  }

  const base = await readJsonIfExists(baseUrl);

  if (checkOnly || !base) {
    // No base seed file (the original 96-prompt bank) is present in this
    // checkout, or --check was requested: don't attempt to rebuild
    // guided-prompts.sa.ar.json — the committed file at outputUrl is the
    // authoritative, version-controlled dataset. Validate it in place
    // instead, including cross-checking it stayed consistent with the
    // catalog source.
    const dataset = await readJsonIfExists(outputUrl);
    if (!dataset) {
      throw new Error(`Missing authoritative dataset: ${outputUrl.pathname}`);
    }
    const errors = validateGuidedPromptsDataset(dataset, catalog);
    if (errors.length > 0) {
      console.error(
        `Guided prompts dataset validation failed with ${errors.length} error(s):\n` +
          errors.map((e) => `  - ${e}`).join("\n"),
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `Guided prompts dataset OK: ${dataset.prompts.length} prompts, ` +
        `${Object.keys(dataset.category_labels_ar).length} categories.` +
        (base
          ? ""
          : " (base seed file absent — validated the committed dataset only.)"),
    );
    return;
  }

  // Full rebuild path: only reachable when the original base seed file exists.
  const additions = catalog.categories.flatMap((category) =>
    category.prompts.map((prompt) => ({
      ...prompt,
      category: category.id,
      answer_form: prompt.answer_form ?? catalog.category_defaults.answer_form,
      prompt_version:
        prompt.prompt_version ?? catalog.category_defaults.prompt_version,
      is_active: prompt.is_active ?? catalog.category_defaults.is_active,
      coverage_tags: category.coverage_tags,
    })),
  );

  const baseCategoryLabels = {
    questions: "أدوات السؤال",
    discourse: "أدوات الخطاب",
    time: "الوقت",
    quantity: "الكمية والدرجة",
    movement_actions: "الحركة",
    interaction_verbs: "أفعال التفاعل",
    routine_verbs: "الأفعال اليومية",
    states: "الحالات الجسدية",
    emotions: "المشاعر",
    people: "الأشخاص",
    home_objects: "أغراض المنزل",
    common_phrases: "عبارات شائعة",
  };

  const prompts = [...base.prompts, ...additions];
  const categoryLabels = {
    ...baseCategoryLabels,
    ...Object.fromEntries(
      catalog.categories.map(({ id, label_ar }) => [id, label_ar]),
    ),
  };

  const output = {
    schema_version: 2,
    language: "ar-SA",
    country_scope: "SA",
    dialect_scope: {
      leaderboard_parent_groups: [
        { id: "najdi", label_ar: "نجدي", region_ar: "الوسطى" },
        { id: "eastern", label_ar: "شرقي", region_ar: "الشرقية" },
        { id: "hijazi", label_ar: "حجازي", region_ar: "الغربية" },
        { id: "northern", label_ar: "شمالي", region_ar: "الشمالية" },
        { id: "southern", label_ar: "جنوبي", region_ar: "الجنوبية" },
      ],
      preserve_local_label: true,
      local_label_examples_ar: ["المدينة أو المحافظة", "المسمى المحلي للهجة"],
      prohibited_required_identity_fields: ["tribe"],
    },
    license:
      "Project-authored Arabic prompt text. Concept selection is informed by Concepticon 3.4.0 (CC BY 4.0); see guided-prompts-sources.md.",
    selection_rule:
      "Use Saudi-only dialect filters. Rotate semantic categories, prioritize missing concept-by-dialect coverage, and never reveal dialect answers before contribution.",
    category_labels_ar: categoryLabels,
    prompts,
  };

  const errors = validateGuidedPromptsDataset(output, catalog);
  if (errors.length > 0) {
    throw new Error(
      `Rebuilt dataset failed validation:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  await writeFile(outputUrl, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputUrl.pathname} with ${prompts.length} prompts.`);
}

await main();
