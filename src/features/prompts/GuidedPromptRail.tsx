"use client";

import type { GuidedPromptRecord } from "./types";
import { Button } from "@/components/ui/Button";

interface GuidedPromptRailProps {
  prompts: GuidedPromptRecord[];
  onChoose: (prompt: GuidedPromptRecord) => void;
  loading?: boolean;
}

export function GuidedPromptRail({
  prompts,
  onChoose,
  loading,
}: GuidedPromptRailProps) {
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
      </div>

      {loading ? (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          aria-hidden="true"
        >
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="border-border bg-surface-muted h-32 animate-pulse rounded-2xl border"
            />
          ))}
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
            <li
              key={prompt.id}
              className="w-[78%] shrink-0 snap-start sm:w-auto"
            >
              <div className="border-border bg-surface flex h-full flex-col justify-between gap-3 rounded-2xl border p-4 shadow-sm">
                <div className="flex flex-col gap-1.5">
                  <span className="bg-surface-muted text-foreground/60 inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium">
                    {prompt.categoryLabelAr}
                  </span>
                  <p className="text-foreground text-lg font-bold">
                    {prompt.msaLemma}
                  </p>
                  <p className="text-foreground/70 text-sm">
                    {prompt.definitionAr}
                  </p>
                  <p className="text-foreground/50 text-xs">
                    {prompt.scenarioAr}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => onChoose(prompt)}
                >
                  أعرف كلمة لهذا المعنى
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
