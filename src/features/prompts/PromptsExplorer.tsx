"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  listReferencePromptsPage,
  type GuidedPromptPage,
  type PromptCategoryCount,
} from "./actions";
import { PromptCard } from "./PromptCard";
import { getAnsweredIds, resetAnsweredIds } from "./prompt-history";
import { setPendingPromptSelection } from "./pending-selection";
import type { GuidedPromptRecord } from "./types";
import { Button } from "@/components/ui/Button";

const PAGE_SIZE = 24;

const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
function toArabicDigits(n: number): string {
  return String(n)
    .split("")
    .map((d) => ARABIC_DIGITS[Number(d)] ?? d)
    .join("");
}

interface PromptsExplorerProps {
  initial: GuidedPromptPage;
  categories: PromptCategoryCount[];
}

export function PromptsExplorer({ initial, categories }: PromptsExplorerProps) {
  const router = useRouter();
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<GuidedPromptPage>(initial);
  const [pending, startTransition] = useTransition();
  const [errored, setErrored] = useState(false);
  const [answeredFilter, setAnsweredFilter] = useState<
    "all" | "answered" | "unanswered"
  >("all");
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnsweredIds(new Set(getAnsweredIds()));
  }, []);

  const grandTotal = useMemo(
    () => categories.reduce((sum, c) => sum + c.count, 0),
    [categories],
  );

  function runQuery(next: {
    category?: string;
    search?: string;
    page?: number;
  }) {
    const nextCategory = next.category ?? category;
    const nextSearch = next.search ?? search;
    const nextPage = next.page ?? 1;
    setErrored(false);
    startTransition(async () => {
      try {
        const nextResult = await listReferencePromptsPage({
          category: nextCategory || undefined,
          search: nextSearch,
          offset: (nextPage - 1) * PAGE_SIZE,
          limit: PAGE_SIZE,
        });
        setResult(nextResult);
        setPage(nextPage);
      } catch {
        setErrored(true);
      }
    });
  }

  function chooseCard(prompt: GuidedPromptRecord) {
    setPendingPromptSelection(prompt);
    router.push("/#contribute");
  }

  function handleResetProgress() {
    if (
      !confirm(
        "سيتم مسح سجل الكلمات التي أجبت عنها على هذا الجهاز فقط، ولن يتأثر أي شيء في قاعدة البيانات. متابعة؟",
      )
    )
      return;
    resetAnsweredIds();
    setAnsweredIds(new Set());
  }

  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const visibleRows = result.rows.filter((row) => {
    if (answeredFilter === "answered") return answeredIds.has(row.id);
    if (answeredFilter === "unanswered") return !answeredIds.has(row.id);
    return true;
  });

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <aside className="border-border bg-surface flex shrink-0 flex-row gap-1 overflow-x-auto rounded-2xl border p-2 md:sticky md:top-4 md:w-56 md:flex-col md:overflow-visible">
        <CategoryButton
          label="كل التصنيفات"
          count={grandTotal}
          active={category === ""}
          onClick={() => {
            setCategory("");
            runQuery({ category: "" });
          }}
        />
        {categories.map((c) => (
          <CategoryButton
            key={c.category}
            label={c.categoryLabelAr}
            count={c.count}
            active={category === c.category}
            onClick={() => {
              setCategory(c.category);
              runQuery({ category: c.category });
            }}
          />
        ))}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="prompts-search" className="sr-only">
            ابحث في المعاني
          </label>
          <input
            id="prompts-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runQuery({ search });
            }}
            placeholder="ابحث بالمعنى الفصيح"
            className="border-border bg-surface text-foreground min-h-11 min-w-48 flex-1 rounded-lg border px-3 py-2 text-base"
          />
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => runQuery({ search })}
          >
            بحث
          </Button>
          <select
            value={answeredFilter}
            onChange={(e) =>
              setAnsweredFilter(e.target.value as typeof answeredFilter)
            }
            className="border-border bg-surface text-foreground min-h-11 rounded-lg border px-3 py-2 text-sm"
            aria-label="تصفية حسب الإجابة على هذا الجهاز"
          >
            <option value="all">الكل</option>
            <option value="answered">أجبت عنها</option>
            <option value="unanswered">لم أُجب عنها</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-foreground/70 text-sm" aria-live="polite">
            أجبت عن {toArabicDigits(answeredIds.size)} من{" "}
            {toArabicDigits(grandTotal)} على هذا الجهاز
          </p>
          {answeredIds.size > 0 ? (
            <Button
              type="button"
              variant="ghost"
              className="text-xs"
              onClick={handleResetProgress}
            >
              إعادة تعيين التقدّم المحلي
            </Button>
          ) : null}
        </div>

        {errored ? (
          <p
            role="alert"
            className="border-danger bg-danger/10 text-danger rounded-lg border px-3 py-2 text-sm"
          >
            تعذّر تحميل المعاني. حاول مرة أخرى.
          </p>
        ) : null}

        {pending ? (
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
        ) : visibleRows.length === 0 ? (
          <p className="border-border bg-surface-muted text-foreground/60 rounded-xl border px-4 py-8 text-center text-sm">
            {result.rows.length === 0
              ? "لا توجد نتائج مطابقة."
              : "لا توجد معانٍ مطابقة لهذا الفلتر في هذه الصفحة — جرّب صفحة أخرى."}
          </p>
        ) : (
          <ul
            role="list"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {visibleRows.map((row) => (
              <PromptCard
                key={row.id}
                prompt={row}
                variant="grid"
                answered={answeredIds.has(row.id)}
                onChoose={chooseCard}
              />
            ))}
          </ul>
        )}

        {totalPages > 1 ? (
          <nav
            aria-label="التنقّل بين صفحات المعاني"
            className="flex items-center justify-center gap-3"
          >
            <Button
              type="button"
              variant="secondary"
              disabled={page <= 1 || pending}
              onClick={() => runQuery({ page: page - 1 })}
            >
              السابق
            </Button>
            <span className="text-foreground/70 text-sm">
              صفحة {toArabicDigits(page)} من {toArabicDigits(totalPages)}
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={page >= totalPages || pending}
              onClick={() => runQuery({ page: page + 1 })}
            >
              التالي
            </Button>
          </nav>
        ) : null}
      </div>
    </div>
  );
}

function CategoryButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-11 shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-sm font-medium whitespace-nowrap ${
        active
          ? "bg-accent/10 text-accent"
          : "text-foreground/80 hover:bg-surface-muted"
      }`}
    >
      <span>{label}</span>
      <span className="text-foreground/50 text-xs">
        {toArabicDigits(count)}
      </span>
    </button>
  );
}
