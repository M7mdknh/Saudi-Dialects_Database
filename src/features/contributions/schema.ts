import { z } from "zod";
import {
  FIELD_LIMITS,
  MAX_EXAMPLES_PER_WORD,
  MAX_WORD_CARDS,
} from "./constants";

export const exampleSchema = z.object({
  sentence: z
    .string()
    .trim()
    .min(1, "أدخل مثالاً أو احذف هذا الحقل")
    .max(FIELD_LIMITS.example, `الحد الأقصى ${FIELD_LIMITS.example} حرفاً`),
});

export const wordCardSchema = z.object({
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
  msaSynonym: z
    .string()
    .trim()
    .min(1, "المرادف بالفصحى مطلوب")
    .max(
      FIELD_LIMITS.msaSynonym,
      `الحد الأقصى ${FIELD_LIMITS.msaSynonym} حرفاً`,
    ),
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
    .max(MAX_EXAMPLES_PER_WORD, `الحد الأقصى ${MAX_EXAMPLES_PER_WORD} أمثلة`),
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
