// Shared validation for the authoritative guided-prompts dataset. Imported
// by scripts/build-guided-prompts.mjs (CLI) and by the Vitest suite, so the
// rules are defined exactly once.

export const EXPECTED_PROMPT_COUNT = 300;
export const ALLOWED_PRIORITIES = [80, 90, 100];
const REQUIRED_STRING_FIELDS = [
  "id",
  "msa_lemma",
  "definition_ar",
  "scenario_ar",
  "category",
  "part_of_speech",
  "answer_form",
];
const ARABIC_TEXT_FIELDS = ["msa_lemma", "definition_ar", "scenario_ar"];
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HAS_ARABIC = /[؀-ۿ]/;
const REPLACEMENT_CHAR = /�/;
const HTML_TAG = /<[^>]*>/;

/**
 * @param {unknown} dataset parsed guided-prompts.sa.ar.json
 * @param {unknown} [catalog] parsed guided-prompts.sa.catalog.json, used to
 *   detect drift between the generated dataset and its catalog source.
 * @returns {string[]} human-readable error messages; empty when valid.
 */
export function validateGuidedPromptsDataset(dataset, catalog) {
  const errors = [];

  if (!dataset || typeof dataset !== "object") {
    return ["dataset is not an object"];
  }
  if (!Array.isArray(dataset.prompts)) {
    return ["dataset.prompts is not an array"];
  }
  if (
    !dataset.category_labels_ar ||
    typeof dataset.category_labels_ar !== "object"
  ) {
    errors.push("dataset.category_labels_ar is missing or not an object");
  }

  const prompts = dataset.prompts;
  if (prompts.length !== EXPECTED_PROMPT_COUNT) {
    errors.push(
      `expected exactly ${EXPECTED_PROMPT_COUNT} prompts, found ${prompts.length}`,
    );
  }

  const seenIds = new Set();
  const categoryLabels = dataset.category_labels_ar ?? {};

  for (const [index, prompt] of prompts.entries()) {
    const label = prompt?.id ?? `index ${index}`;

    for (const field of REQUIRED_STRING_FIELDS) {
      if (typeof prompt?.[field] !== "string" || prompt[field].trim() === "") {
        errors.push(
          `prompt "${label}": missing or empty required field "${field}"`,
        );
      }
    }

    if (typeof prompt?.id === "string") {
      if (!KEBAB_CASE.test(prompt.id)) {
        errors.push(`prompt "${label}": id is not stable kebab-case`);
      }
      if (seenIds.has(prompt.id)) {
        errors.push(`prompt "${label}": duplicate stable id`);
      }
      seenIds.add(prompt.id);
    }

    if (!ALLOWED_PRIORITIES.includes(prompt?.priority)) {
      errors.push(
        `prompt "${label}": unsupported priority ${prompt?.priority}`,
      );
    }
    if (
      !Number.isInteger(prompt?.prompt_version) ||
      prompt.prompt_version < 1
    ) {
      errors.push(
        `prompt "${label}": prompt_version must be a positive integer`,
      );
    }
    if (typeof prompt?.is_active !== "boolean") {
      errors.push(`prompt "${label}": is_active must be a boolean`);
    }

    if (
      typeof prompt?.category === "string" &&
      !categoryLabels[prompt.category]
    ) {
      errors.push(
        `prompt "${label}": category "${prompt.category}" has no entry in category_labels_ar`,
      );
    }

    for (const field of ARABIC_TEXT_FIELDS) {
      const value = prompt?.[field];
      if (typeof value !== "string") continue;
      if (!HAS_ARABIC.test(value)) {
        errors.push(
          `prompt "${label}": field "${field}" contains no Arabic characters`,
        );
      }
      if (REPLACEMENT_CHAR.test(value)) {
        errors.push(
          `prompt "${label}": field "${field}" contains a Unicode replacement character (mojibake)`,
        );
      }
      if (HTML_TAG.test(value)) {
        errors.push(`prompt "${label}": field "${field}" contains raw markup`);
      }
    }
  }

  if (
    catalog &&
    typeof catalog === "object" &&
    Array.isArray(catalog.categories)
  ) {
    const byId = new Map(prompts.map((p) => [p?.id, p]));
    for (const category of catalog.categories) {
      for (const catalogPrompt of category.prompts ?? []) {
        const merged = byId.get(catalogPrompt.id);
        if (!merged) {
          errors.push(
            `catalog prompt "${catalogPrompt.id}" is missing from the authoritative dataset`,
          );
          continue;
        }
        if (merged.category !== category.id) {
          errors.push(
            `catalog prompt "${catalogPrompt.id}": dataset category "${merged.category}" does not match catalog category "${category.id}" (dataset is out of sync with the catalog)`,
          );
        }
        for (const field of ["msa_lemma", "definition_ar", "scenario_ar"]) {
          if (
            catalogPrompt[field] !== undefined &&
            catalogPrompt[field] !== merged[field]
          ) {
            errors.push(
              `catalog prompt "${catalogPrompt.id}": dataset field "${field}" does not match the catalog source (dataset is out of sync with the catalog)`,
            );
          }
        }
      }
      if (
        category.label_ar &&
        categoryLabels[category.id] !== category.label_ar
      ) {
        errors.push(
          `category "${category.id}": dataset label "${categoryLabels[category.id]}" does not match catalog label "${category.label_ar}"`,
        );
      }
    }
  }

  return errors;
}
