"use client";

import type { WordCardInput } from "./schema";
import {
  FIELD_LIMITS,
  MAIN_GROUP_OPTIONS,
  MAX_EXAMPLES_PER_WORD,
} from "./constants";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { DialectCombobox } from "./DialectCombobox";
import type { PublicDialectOption } from "./dialects-actions";
import { toSearchKey } from "@/lib/text/normalize-arabic";

export type FieldErrors = Record<string, string | undefined>;

interface WordCardProps {
  index: number;
  total: number;
  card: WordCardInput;
  errors?: FieldErrors;
  dialectOptions: PublicDialectOption[];
  onUpdateField: (
    field: "word" | "dialect" | "msaSynonym" | "explanation",
    value: string,
  ) => void;
  onUpdateDialect: (value: string, dialectId: string | null) => void;
  onUpdateProvisionalMainGroup: (value: string) => void;
  onUpdateExample: (index: number, value: string) => void;
  onAddExample: () => void;
  onRemoveExample: (index: number) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onAddAnotherForSamePrompt?: () => void;
  canRemove: boolean;
}

export function WordCard({
  index,
  total,
  card,
  errors = {},
  dialectOptions,
  onUpdateField,
  onUpdateDialect,
  onUpdateProvisionalMainGroup,
  onUpdateExample,
  onAddExample,
  onRemoveExample,
  onRemove,
  onMoveUp,
  onMoveDown,
  onAddAnotherForSamePrompt,
  canRemove,
}: WordCardProps) {
  const base = `word-${card.clientId}`;
  const isGuided = Boolean(
    card.referencePromptId && card.referencePromptSnapshot,
  );
  // A custom (freely-typed, unmatched) dialect label needs the contributor
  // to declare its broad group — an existing dialect row's group is already
  // known and derived live server-side (see submit_batch / the leaderboard
  // aggregation), so no extra field is needed once dialectId is set.
  const isCustomDialect = Boolean(card.dialect.trim()) && !card.dialectId;

  function handleDialectChange(value: string) {
    const key = toSearchKey(value);
    const matched = key
      ? dialectOptions.find((o) => toSearchKey(o.nameAr) === key)
      : undefined;
    onUpdateDialect(value, matched?.id ?? null);
  }

  return (
    <section
      className={`bg-surface flex flex-col gap-4 rounded-2xl border p-4 shadow-sm sm:p-5 ${
        isGuided ? "border-accent/40 ring-accent/15 ring-1" : "border-border"
      }`}
      aria-labelledby={`${base}-heading`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2
            id={`${base}-heading`}
            className="text-foreground text-base font-bold"
          >
            الكلمة {toArabicDigits(index + 1)}
          </h2>
          {isGuided ? (
            <span className="bg-accent/10 text-accent inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold">
              مرتبطة بمعنى مقترح
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 min-w-11 px-2 text-xs"
            onClick={onMoveUp}
            disabled={index === 0}
            aria-label="نقل الكلمة للأعلى"
          >
            ▲
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 min-w-11 px-2 text-xs"
            onClick={onMoveDown}
            disabled={index === total - 1}
            aria-label="نقل الكلمة للأسفل"
          >
            ▼
          </Button>
          {canRemove ? (
            <Button
              type="button"
              variant="ghost"
              className="text-danger min-h-11 px-2 text-xs"
              onClick={onRemove}
              aria-label={`حذف الكلمة ${toArabicDigits(index + 1)}`}
            >
              حذف
            </Button>
          ) : null}
        </div>
      </div>

      {isGuided && card.referencePromptSnapshot ? (
        <p className="bg-surface-muted text-foreground/70 rounded-lg px-3 py-2 text-sm">
          {card.referencePromptSnapshot.scenarioAr}
        </p>
      ) : null}

      <Field
        id={`${base}-word`}
        label="الكلمة باللهجة"
        required
        error={errors.word}
      >
        <input
          id={`${base}-word`}
          value={card.word}
          maxLength={FIELD_LIMITS.word}
          onChange={(e) => onUpdateField("word", e.target.value)}
          className={inputClass(Boolean(errors.word))}
          aria-invalid={Boolean(errors.word)}
          aria-describedby={errors.word ? `${base}-word-error` : undefined}
        />
      </Field>

      <Field
        id={`${base}-dialect`}
        label="اللهجة أو المنطقة"
        required
        error={errors.dialect}
      >
        <DialectCombobox
          id={`${base}-dialect`}
          value={card.dialect}
          options={dialectOptions}
          onChange={handleDialectChange}
          error={errors.dialect}
        />
      </Field>

      {isCustomDialect ? (
        <Field
          id={`${base}-main-group`}
          label="تتبع أي مجموعة رئيسية؟"
          required
          error={errors.provisionalMainGroupCode}
          hint="لهجتك ليست في القائمة — اختر أقرب مجموعة رئيسية لها."
        >
          <select
            id={`${base}-main-group`}
            value={card.provisionalMainGroupCode ?? ""}
            onChange={(e) => onUpdateProvisionalMainGroup(e.target.value)}
            className={inputClass(Boolean(errors.provisionalMainGroupCode))}
            aria-invalid={Boolean(errors.provisionalMainGroupCode)}
          >
            <option value="">اختر المجموعة الرئيسية</option>
            {MAIN_GROUP_OPTIONS.map((g) => (
              <option key={g.code} value={g.code}>
                {g.labelAr}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <Field
        id={`${base}-msa`}
        label="المرادف بالعربية الفصحى"
        error={errors.msaSynonym}
      >
        {isGuided ? (
          <p
            id={`${base}-msa`}
            className="border-border bg-surface-muted text-foreground/80 min-h-11 w-full rounded-lg border px-3 py-2 text-base"
          >
            {card.msaSynonym}
          </p>
        ) : (
          <input
            id={`${base}-msa`}
            value={card.msaSynonym ?? ""}
            maxLength={FIELD_LIMITS.msaSynonym}
            onChange={(e) => onUpdateField("msaSynonym", e.target.value)}
            className={inputClass(Boolean(errors.msaSynonym))}
            aria-invalid={Boolean(errors.msaSynonym)}
          />
        )}
      </Field>

      <Field
        id={`${base}-explanation`}
        label="المعنى ومتى تُستخدم"
        error={errors.explanation}
      >
        {isGuided ? (
          <p
            id={`${base}-explanation`}
            className="border-border bg-surface-muted text-foreground/80 w-full rounded-lg border px-3 py-2 text-base"
          >
            {card.explanation}
          </p>
        ) : (
          <textarea
            id={`${base}-explanation`}
            value={card.explanation ?? ""}
            maxLength={FIELD_LIMITS.explanation}
            rows={3}
            onChange={(e) => onUpdateField("explanation", e.target.value)}
            className={inputClass(Boolean(errors.explanation))}
          />
        )}
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-foreground text-sm font-medium">
          الأمثلة <span className="text-danger">*</span>
        </legend>
        <div className="flex flex-col gap-2">
          {card.examples.map((ex, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1">
                <label htmlFor={`${base}-example-${i}`} className="sr-only">
                  {i === 0
                    ? "مثال في جملة"
                    : `مثال إضافي ${toArabicDigits(i + 1)}`}
                </label>
                <input
                  id={`${base}-example-${i}`}
                  value={ex.sentence}
                  maxLength={FIELD_LIMITS.example}
                  placeholder={i === 0 ? "مثال في جملة" : "مثال إضافي"}
                  onChange={(e) => onUpdateExample(i, e.target.value)}
                  className={inputClass(Boolean(errors[`example-${i}`]))}
                  aria-invalid={Boolean(errors[`example-${i}`])}
                />
                {errors[`example-${i}`] ? (
                  <p
                    role="alert"
                    className="text-danger mt-1 text-sm font-medium"
                  >
                    {errors[`example-${i}`]}
                  </p>
                ) : null}
              </div>
              {card.examples.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-danger min-h-11 px-2 text-xs"
                  onClick={() => onRemoveExample(i)}
                  aria-label={`حذف المثال ${toArabicDigits(i + 1)}`}
                >
                  حذف
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          onClick={onAddExample}
          disabled={card.examples.length >= MAX_EXAMPLES_PER_WORD}
        >
          + إضافة مثال
        </Button>
      </fieldset>

      {isGuided && onAddAnotherForSamePrompt ? (
        <Button
          type="button"
          variant="ghost"
          className="self-start text-sm"
          onClick={onAddAnotherForSamePrompt}
        >
          + كلمة أخرى لنفس المعنى (من منطقة مختلفة مثلًا)
        </Button>
      ) : null}
    </section>
  );
}

function inputClass(hasError: boolean) {
  return `min-h-11 w-full rounded-lg border bg-surface px-3 py-2 text-base text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
    hasError ? "border-danger" : "border-border"
  }`;
}

const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
function toArabicDigits(n: number): string {
  return String(n)
    .split("")
    .map((d) => ARABIC_DIGITS[Number(d)] ?? d)
    .join("");
}
