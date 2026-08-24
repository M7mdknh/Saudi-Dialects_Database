import type { z } from "zod";

/**
 * Maps Zod issues from `submissionBatchSchema` to the shape WordCard expects:
 * `{ [wordIndex]: { [fieldName]: message } }`, where an example's field name
 * is `example-<exampleIndex>` (not the raw `examples-<i>-sentence` path).
 * Shared by the client form and the server route so both surfaces highlight
 * the same field for the same issue.
 */
export function mapZodIssuesToFieldErrors(
  error: z.ZodError,
): Record<string, Record<string, string>> {
  const mapped: Record<string, Record<string, string>> = {};
  for (const issue of error.issues) {
    if (issue.path[0] === "words" && typeof issue.path[1] === "number") {
      const index = String(issue.path[1]);
      const rest = issue.path.slice(2);
      const field =
        rest[0] === "examples" && typeof rest[1] === "number"
          ? `example-${rest[1]}`
          : String(rest[0] ?? "word");
      mapped[index] = { ...mapped[index], [field]: issue.message };
    }
  }
  return mapped;
}
