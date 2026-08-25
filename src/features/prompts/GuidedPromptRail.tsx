"use client";

import type { GuidedPromptRecord } from "./types";
import { PromptCard } from "./PromptCard";
import { Button } from "@/components/ui/Button";

const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
function toArabicDigits(n: number): string {
  return String(n)
    .split("")
    .map((d) => ARABIC_DIGITS[Number(d)] ?? d)
    .join("");
}

interface GuidedPromptRailProps {
  prompts: GuidedPromptRecord[];
  onChoose: (prompt: GuidedPromptRecord) => void;
  loading?: boolean;
  /** True when the last fetch (initial load or refresh) failed — distinct from a genuine empty result. */
  error?: boolean;
  onRetry?: () => void;
  answeredIds?: Set<string>;
  offset?: number;
  total?: number;
  onNext?: () => void;
  onPrev?: () => void;
}

export function GuidedPromptRail({
  prompts,
  onChoose,
  loading,
  error,
  onRetry,
  answeredIds,
  offset = 0,
  total = 0,
  onNext,
  onPrev,
}: GuidedPromptRailProps) {
  const rangeStart = total > 0 ? offset + 1 : 0;
  const rangeEnd = Math.min(offset + prompts.length, total);
  const showPager = Boolean(onNext) && total > prompts.length;

  return (
    <section
      aria-labelledby="guided-prompts-heading"
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex flex-col gap-1 text-center">
        <h2
          id="guided-prompts-heading"
          className="text-foreground text-lg font-bold"
        >
          وش تسمّون هذا بلهجتكم؟
        </h2>
        <p className="text-foreground/70 text-sm">
          اختر معنى، واكتب لنا الكلمة التي تستخدمونها في منطقتكم.
        </p>
        {!loading && !error && total > 0 ? (
          <p className="text-foreground/50 text-xs" aria-live="polite">
            {toArabicDigits(rangeStart)}–{toArabicDigits(rangeEnd)} من{" "}
            {toArabicDigits(total)}
          </p>
        ) : null}
      </div>

      {loading ? (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          aria-hidden="true"
        >
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="border-border bg-surface-muted h-[136px] animate-pulse rounded-2xl border"
            />
          ))}
        </div>
      ) : error ? (
        <div
          role="alert"
          className="border-border bg-surface-muted flex flex-col items-center gap-3 rounded-xl border px-4 py-6 text-center text-sm"
        >
          <p className="text-foreground/70">
            تعذّر تحميل الاقتراحات الآن. يمكنك إضافة كلمتك مباشرة في الأسفل.
          </p>
          {onRetry ? (
            <Button type="button" variant="secondary" onClick={onRetry}>
              إعادة المحاولة
            </Button>
          ) : null}
        </div>
      ) : prompts.length === 0 ? (
        <p className="border-border bg-surface-muted text-foreground/60 rounded-xl border px-4 py-6 text-center text-sm">
          لا توجد اقتراحات متاحة الآن. يمكنك إضافة كلمتك مباشرة في الأسفل.
        </p>
      ) : (
        <ul
          role="list"
          className="-mx-4 flex min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:min-w-full sm:snap-none sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3"
          aria-label="معانٍ مقترحة للمساهمة"
        >
          {prompts.map((prompt) => (
            <PromptCard
              key={prompt.id}
              prompt={prompt}
              variant="rail"
              answered={answeredIds?.has(prompt.id) ?? false}
              onChoose={onChoose}
            />
          ))}
        </ul>
      )}

      {showPager ? (
        <div className="flex items-center justify-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={loading || offset <= 0}
            onClick={onPrev}
          >
            الكلمات السابقة
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={onNext}
          >
            الكلمات التالية
          </Button>
        </div>
      ) : null}
    </section>
  );
}
