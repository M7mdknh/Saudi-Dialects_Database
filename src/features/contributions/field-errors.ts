import type { z } from "zod";

/**
 * Maps Zod issues from `submissionBatchSchema` to the shape WordCard expects:
 * `{ [wordClientId]: { [fieldName]: message } }`, where an example's field
 * name is `example-<exampleIndex>` (not the raw `examples-<i>-sentence`
 * path).
 *
 * Keyed by each word's stable `clientId` rather than its array position: a
 * word card can be reordered or an earlier card removed after a failed
 * validation, and a position-keyed map would then reattach a stale error to
 * whichever card now happens to occupy that slot. `words` is the same
 * (possibly not-yet-fully-valid) array that was passed to the schema, read
 * only for each entry's `clientId`, so this stays correct even though the
 * parse itself failed.
 *
 * Shared by the client form and the server route so both surfaces highlight
 * the same field for the same issue.
 */
export function mapZodIssuesToFieldErrors(
  error: z.ZodError,
  words: readonly unknown[] = [],
): Record<string, Record<string, string>> {
  const mapped: Record<string, Record<string, string>> = {};
  for (const issue of error.issues) {
    if (issue.path[0] === "words" && typeof issue.path[1] === "number") {
      const wordIndex = issue.path[1];
      const key = clientIdAt(words, wordIndex) ?? `index-${wordIndex}`;
      const rest = issue.path.slice(2);
      const field =
        rest[0] === "examples" && typeof rest[1] === "number"
          ? `example-${rest[1]}`
          : String(rest[0] ?? "word");
      mapped[key] = { ...mapped[key], [field]: issue.message };
    }
  }
  return mapped;
}

function clientIdAt(words: readonly unknown[], index: number): string | null {
  const word = words[index];
  if (typeof word !== "object" || word === null) return null;
  const clientId = (word as { clientId?: unknown }).clientId;
  return typeof clientId === "string" && clientId.length > 0 ? clientId : null;
}
