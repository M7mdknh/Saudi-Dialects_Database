// Two pieces of non-sensitive, per-device state — no personal data, no
// account, no server-side tracking. Both live in localStorage (not
// sessionStorage): the ordered progression position and the answered set
// are meant to persist "on this device" across visits, per the product
// spec — a visitor who left mid-list should come back to where they were.

const OFFSET_KEY = "lahajat.prompts.offset.v2";
const ANSWERED_KEY = "lahajat.prompts.answered.v2";

const isBrowser = () => typeof window !== "undefined";

function readJson<T>(
  key: string,
  fallback: T,
  isValid: (v: unknown) => v is T,
): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort; storage may be unavailable (private mode/quota)
  }
}

function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** The visitor's current position in the ordered prompt list — recovers to 0 on corrupt/missing/invalid storage. */
export function getPromptOffset(): number {
  return readJson(OFFSET_KEY, 0, isNonNegativeInteger);
}

export function setPromptOffset(offset: number): void {
  writeJson(OFFSET_KEY, Math.max(0, Math.trunc(offset)));
}

/** Prompt ids the visitor has answered (submitted a word for) on this device, ever — never expires, never blocks re-display. */
export function getAnsweredIds(): string[] {
  return readJson(ANSWERED_KEY, [], isStringArray);
}

export function isAnswered(id: string): boolean {
  return getAnsweredIds().includes(id);
}

export function recordAnsweredId(id: string): void {
  const existing = getAnsweredIds();
  if (existing.includes(id)) return;
  writeJson(ANSWERED_KEY, [...existing, id]);
}

export function getAnsweredCount(): number {
  return getAnsweredIds().length;
}

/** Explicit reset action (with user confirmation in the UI) — clears local progress only, never touches the server dataset. */
export function resetAnsweredIds(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(ANSWERED_KEY);
  } catch {
    // best-effort
  }
}
