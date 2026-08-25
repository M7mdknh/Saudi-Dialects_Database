// Non-sensitive, ephemeral prompt-history tracking only — no personal data,
// no visitor profile, no view-event tracking. Just stable prompt IDs, used
// only to avoid repeating prompts the visitor just saw or answered.

const RECENTLY_SHOWN_KEY = "lahajat.prompts.recently-shown.v1";
const ANSWERED_THIS_SESSION_KEY = "lahajat.prompts.answered-session.v1";
const MAX_RECENTLY_SHOWN = 42; // ~7 rotations of 6 — old entries age out (FIFO).

const isBrowser = () => typeof window !== "undefined";

function readIds(storage: Storage, key: string): string[] {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x) => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function writeIds(storage: Storage, key: string, ids: string[]): void {
  try {
    storage.setItem(key, JSON.stringify(ids));
  } catch {
    // best-effort; storage may be unavailable (private mode/quota)
  }
}

export function getRecentlyShownIds(): string[] {
  if (!isBrowser()) return [];
  return readIds(window.localStorage, RECENTLY_SHOWN_KEY);
}

export function recordShownIds(ids: string[]): void {
  if (!isBrowser() || ids.length === 0) return;
  const existing = readIds(window.localStorage, RECENTLY_SHOWN_KEY);
  const merged = [...existing, ...ids.filter((id) => !existing.includes(id))];
  const trimmed = merged.slice(Math.max(0, merged.length - MAX_RECENTLY_SHOWN));
  writeIds(window.localStorage, RECENTLY_SHOWN_KEY, trimmed);
}

export function getAnsweredThisSessionIds(): string[] {
  if (!isBrowser()) return [];
  return readIds(window.sessionStorage, ANSWERED_THIS_SESSION_KEY);
}

export function recordAnsweredId(id: string): void {
  if (!isBrowser()) return;
  const existing = readIds(window.sessionStorage, ANSWERED_THIS_SESSION_KEY);
  if (existing.includes(id)) return;
  writeIds(window.sessionStorage, ANSWERED_THIS_SESSION_KEY, [...existing, id]);
}

/** Combined exclusion list to pass to the next prompt-selection request. */
export function getExclusionIds(): string[] {
  return [
    ...new Set([...getRecentlyShownIds(), ...getAnsweredThisSessionIds()]),
  ];
}
