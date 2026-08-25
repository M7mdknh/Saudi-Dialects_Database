import { z } from "zod";
import {
  FIELD_LIMITS,
  MAIN_GROUP_CODES,
  MAX_EXAMPLES_PER_WORD,
  MAX_WORD_CARDS,
} from "./constants";

export const referencePromptSnapshotSchema = z.object({
  msaLemma: z.string().min(1),
  definitionAr: z.string().min(1),
  scenarioAr: z.string().min(1),
  category: z.string().min(1),
  categoryLabelAr: z.string().min(1),
  promptVersion: z.number().int().min(1),
  capturedAt: z.string(),
});

// No per-item `.min(1)` here: a blank optional extra example row (e.g. an
// unfilled row left over from "+ إضافة مثال") must not by itself fail
// validation — only the whole-array check below (at least one non-blank
// example per word) enforces that. Validating each row in place, before any
// blank rows are dropped, keeps every issue's array index pointing at the
// same position the contributor sees on screen.
export const exampleSchema = z.object({
  sentence: z
    .string()
    .trim()
    .max(FIELD_LIMITS.example, `الحد الأقصى ${FIELD_LIMITS.example} حرفاً`),
});

export const wordCardSchema = z
  .object({
    clientId: z.string().min(1),
    word: z
      .string()
      .trim()
      .min(1, "الكلمة مطلوبة")
      .max(FIELD_LIMITS.word, `الحد الأقصى ${FIELD_LIMITS.word} حرفاً`),
    dialect: z
      .string()
      .trim()
      .min(1, "اللهجة أو المنطقة مطلوبة")
      .max(FIELD_LIMITS.dialect, `الحد الأقصى ${FIELD_LIMITS.dialect} حرفاً`),
    /** Set only when the visitor selected an existing dialect row (main group or local) from the combobox; null for a freely-typed custom label. Drives live main-group attribution server-side. */
    dialectId: z.string().uuid().nullable().optional(),
    /** Required only when dialectId is null (a custom local label) — the contributor's own best guess at the broad group, kept separate from any eventual admin-confirmed classification. */
    provisionalMainGroupCode: z.enum(MAIN_GROUP_CODES).nullable().optional(),
    msaSynonym: z
      .string()
      .trim()
      .max(
        FIELD_LIMITS.msaSynonym,
        `الحد الأقصى ${FIELD_LIMITS.msaSynonym} حرفاً`,
      )
      .optional()
      .or(z.literal("")),
    explanation: z
      .string()
      .trim()
      .max(
        FIELD_LIMITS.explanation,
        `الحد الأقصى ${FIELD_LIMITS.explanation} حرفاً`,
      )
      .optional()
      .or(z.literal("")),
    examples: z
      .array(exampleSchema)
      .min(1, "أضف مثالاً واحداً على الأقل")
      .max(MAX_EXAMPLES_PER_WORD, `الحد الأقصى ${MAX_EXAMPLES_PER_WORD} أمثلة`)
      .superRefine((examples, ctx) => {
        // Every item already passed its own (length-only) check above, so
        // this only runs once positions are settled — safe to report at a
        // fixed index. All-blank is the one whole-array condition: attach it
        // to the first visible example field, matching where a contributor
        // would look.
        const hasContent = examples.some((e) => e.sentence.length > 0);
        if (!hasContent) {
          ctx.addIssue({
            code: "custom",
            path: [0, "sentence"],
            message: "أدخل مثالاً أو احذف هذا الحقل",
          });
        }
      })
      .transform((examples) => {
        // Now that validation has passed, silently drop blank optional extra
        // rows from the submitted payload — never send an empty example.
        const nonBlank = examples.filter((e) => e.sentence.length > 0);
        return nonBlank.length > 0 ? nonBlank : examples.slice(0, 1);
      }),
    referencePromptId: z.string().min(1).nullable().optional(),
    referencePromptSnapshot: referencePromptSnapshotSchema
      .nullable()
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.dialectId && !val.provisionalMainGroupCode) {
      ctx.addIssue({
        code: "custom",
        path: ["provisionalMainGroupCode"],
        message: "اختر المجموعة الرئيسية التي تتبعها هذه اللهجة",
      });
    }
  });

export const submissionBatchSchema = z.object({
  idempotencyKey: z.string().uuid(),
  consent: z.literal(true, {
    error: () => "الموافقة على استخدام المساهمة مطلوبة",
  }),
  consentVersion: z.string().min(1),
  words: z
    .array(wordCardSchema)
    .min(1, "أضف كلمة واحدة على الأقل")
    .max(
      MAX_WORD_CARDS,
      `الحد الأقصى ${MAX_WORD_CARDS} كلمة في الدفعة الواحدة`,
    ),
  turnstileToken: z.string().min(1, "التحقق الأمني مطلوب").optional(),
});

export type WordCardInput = z.infer<typeof wordCardSchema>;
export type SubmissionBatchInput = z.infer<typeof submissionBatchSchema>;

/** Server-side variant: requires the Turnstile token (client omits it only in local dev without a site key). */
export const serverSubmissionBatchSchema = submissionBatchSchema.extend({
  turnstileToken: z.string().min(1, "التحقق الأمني مطلوب"),
});
