import type { WordCardInput } from "./schema";
import { DRAFT_STORAGE_KEY, IDEMPOTENCY_STORAGE_KEY } from "./constants";

export interface DraftState {
  words: WordCardInput[];
  consent: boolean;
  savedAt: string;
}

const isBrowser = () => typeof window !== "undefined";

export function loadDraft(): DraftState | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftState;
    if (!Array.isArray(parsed.words)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(state: Omit<DraftState, "savedAt">): void {
  if (!isBrowser()) return;
  try {
    const payload: DraftState = { ...state, savedAt: new Date().toISOString() };
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage may be unavailable (private mode/quota); autosave is best-effort.
  }
}

export function clearDraft(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // best-effort
  }
}

function generateUuid(): string {
  if (isBrowser() && "randomUUID" in window.crypto) {
    return window.crypto.randomUUID();
  }
  // Fallback for older browsers.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Returns the current draft's idempotency key, creating and persisting one if absent. */
export function getOrCreateIdempotencyKey(): string {
  if (!isBrowser()) return generateUuid();
  try {
    const existing = window.localStorage.getItem(IDEMPOTENCY_STORAGE_KEY);
    if (existing) return existing;
    const created = generateUuid();
    window.localStorage.setItem(IDEMPOTENCY_STORAGE_KEY, created);
    return created;
  } catch {
    return generateUuid();
  }
}

/** Rotates the idempotency key after a confirmed successful submission. */
export function rotateIdempotencyKey(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(IDEMPOTENCY_STORAGE_KEY);
  } catch {
    // best-effort
  }
}
