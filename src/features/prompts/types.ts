/** Public-safe guided prompt shape. Never carries admin/moderation fields. */
export interface GuidedPromptRecord {
  id: string;
  category: string;
  categoryLabelAr: string;
  msaLemma: string;
  definitionAr: string;
  scenarioAr: string;
  partOfSpeech: string;
  answerForm: string;
  priority: number;
  promptVersion: number;
}

/** Snapshot stored with a guided submission: exactly what the contributor saw. */
export interface ReferencePromptSnapshot {
  msaLemma: string;
  definitionAr: string;
  scenarioAr: string;
  category: string;
  categoryLabelAr: string;
  promptVersion: number;
  capturedAt: string;
}

export function toSnapshot(
  prompt: GuidedPromptRecord,
): ReferencePromptSnapshot {
  return {
    msaLemma: prompt.msaLemma,
    definitionAr: prompt.definitionAr,
    scenarioAr: prompt.scenarioAr,
    category: prompt.category,
    categoryLabelAr: prompt.categoryLabelAr,
    promptVersion: prompt.promptVersion,
    capturedAt: new Date().toISOString(),
  };
}
