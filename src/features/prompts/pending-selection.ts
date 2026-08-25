import type { GuidedPromptRecord } from "./types";

// One-shot handoff from /prompts to the homepage's contribution form:
// selecting a prompt there must open the *same* guided contribution
// workflow as the homepage, not a separate form. sessionStorage (not
// localStorage) because this is transient navigation state, not
// per-device history.
const KEY = "lahajat.prompts.pending-selection.v1";

function isGuidedPromptRecord(v: unknown): v is GuidedPromptRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.category === "string" &&
    typeof r.categoryLabelAr === "string" &&
    typeof r.msaLemma === "string" &&
    typeof r.definitionAr === "string" &&
    typeof r.scenarioAr === "string" &&
    typeof r.partOfSpeech === "string" &&
    typeof r.answerForm === "string" &&
    typeof r.priority === "number" &&
    typeof r.promptVersion === "number"
  );
}

export function setPendingPromptSelection(prompt: GuidedPromptRecord): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(prompt));
  } catch {
    // best-effort
  }
}

/** Reads and clears the pending selection (consumed exactly once). */
export function takePendingPromptSelection(): GuidedPromptRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isGuidedPromptRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
