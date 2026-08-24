export const SUBMISSION_ERROR_CODES = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  TURNSTILE_FAILED: "TURNSTILE_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  DUPLICATE_IGNORED: "DUPLICATE_IGNORED",
  SERVER_ERROR: "SERVER_ERROR",
} as const;

export type SubmissionErrorCode =
  (typeof SUBMISSION_ERROR_CODES)[keyof typeof SUBMISSION_ERROR_CODES];

export const SUBMISSION_ERROR_MESSAGES: Record<SubmissionErrorCode, string> = {
  VALIDATION_FAILED: "تحقق من الحقول المظللة ثم أعد الإرسال.",
  TURNSTILE_FAILED: "تعذّر التحقق الأمني. أعد تحميل الصفحة وحاول مرة أخرى.",
  RATE_LIMITED: "تم إرسال عدد كبير من المساهمات مؤخراً. حاول لاحقاً.",
  PAYLOAD_TOO_LARGE: "المحتوى المرسل كبير جداً. قلّل عدد الكلمات أو الأمثلة.",
  DUPLICATE_IGNORED: "تم استلام هذه المساهمة مسبقاً بنجاح.",
  SERVER_ERROR: "حدث خطأ غير متوقع. حاول مرة أخرى بعد قليل.",
};

export function messageForCode(code: string | undefined): string {
  if (code && code in SUBMISSION_ERROR_MESSAGES) {
    return SUBMISSION_ERROR_MESSAGES[code as SubmissionErrorCode];
  }
  return SUBMISSION_ERROR_MESSAGES.SERVER_ERROR;
}
