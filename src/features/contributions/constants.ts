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

export const MAIN_GROUP_CODES = [
  "hijazi",
  "najdi",
  "eastern",
  "northern",
  "southern",
] as const;

export type MainGroupCode = (typeof MAIN_GROUP_CODES)[number];

export const MAIN_GROUP_OPTIONS: { code: MainGroupCode; labelAr: string }[] = [
  { code: "hijazi", labelAr: "حجازي" },
  { code: "najdi", labelAr: "نجدي" },
  { code: "eastern", labelAr: "شرقاوي" },
  { code: "northern", labelAr: "شمالي" },
  { code: "southern", labelAr: "جنوبي" },
];

/** "للهجة الحجازية" style — used only in the post-submission feedback sentence. */
export const MAIN_GROUP_FEMININE_LABELS: Record<MainGroupCode, string> = {
  hijazi: "الحجازية",
  najdi: "النجدية",
  eastern: "الشرقاوية",
  northern: "الشمالية",
  southern: "الجنوبية",
};
