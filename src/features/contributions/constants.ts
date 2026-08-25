export const MAX_WORD_CARDS = 50;
export const MAX_EXAMPLES_PER_WORD = 20;

export const FIELD_LIMITS = {
  word: 200,
  dialect: 120,
  msaSynonym: 200,
  explanation: 2000,
  example: 500,
} as const;

export const CONSENT_VERSION = "v1";

export const DRAFT_STORAGE_KEY = "lahajat.contribution.draft.v1";
export const IDEMPOTENCY_STORAGE_KEY =
  "lahajat.contribution.idempotency-key.v1";
