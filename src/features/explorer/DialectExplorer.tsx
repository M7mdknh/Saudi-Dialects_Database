"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  getDialectWords,
  type DialectWordEntry,
  type DialectWordsPage,
} from "./actions";
import type { MainDialectGroupCode } from "@/lib/supabase/types";
import { Button } from "@/components/ui/Button";

const PAGE_SIZE = 20;

interface DialectExplorerProps {
  mainGroupCode: MainDialectGroupCode;
  initial: DialectWordsPage;
}

export function DialectExplorer({
  mainGroupCode,
  initial,
}: DialectExplorerProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<"newest" | "alphabetical">("newest");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [errored, setErrored] = useState(false);

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of result.rows) {
      if (row.category && row.categoryLabelAr)
        map.set(row.category, row.categoryLabelAr);
    }
    return [...map.entries()];
  }, [result.rows]);

  function runQuery(next: {
    search?: string;
    category?: string;
    sort?: "newest" | "alphabetical";
    page?: number;
  }) {
    const nextSearch = next.search ?? search;
    const nextCategory = next.category ?? category;
    const nextSort = next.sort ?? sort;
    const nextPage = next.page ?? 1;
    setErrored(false);
    startTransition(async () => {
      try {
        const page = await getDialectWords({
          mainGroupCode,
          search: nextSearch,
          category: nextCategory || undefined,
          sort: nextSort,
          limit: PAGE_SIZE,
          offset: (nextPage - 1) * PAGE_SIZE,
        });
        setResult(page);
        setPage(nextPage);
      } catch {
        setErrored(true);
      }
    });
  }

  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const hasFilters = search.trim() !== "" || category !== "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="explorer-search" className="sr-only">
          ابحث في الكلمات
        </label>
        <input
          id="explorer-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runQuery({ search });
          }}
          placeholder="ابحث بالكلمة أو المرادف الفصيح"
          className="border-border bg-surface text-foreground min-h-11 min-w-48 flex-1 rounded-lg border px-3 py-2 text-base"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => runQuery({ search })}
          disabled={pending}
        >
          بحث
        </Button>
        {categories.length > 0 ? (
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              runQuery({ category: e.target.value });
            }}
            className="border-border bg-surface text-foreground min-h-11 rounded-lg border px-3 py-2 text-sm"
            aria-label="التصنيف"
          >
            <option value="">كل التصنيفات</option>
            {categories.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        ) : null}
        <select
          value={sort}
          onChange={(e) => {
            const value = e.target.value as "newest" | "alphabetical";
            setSort(value);
            runQuery({ sort: value });
          }}
          className="border-border bg-surface text-foreground min-h-11 rounded-lg border px-3 py-2 text-sm"
          aria-label="الترتيب"
        >
          <option value="newest">الأحدث</option>
          <option value="alphabetical">أبجديًا</option>
        </select>
      </div>

      {errored ? (
        <p
          role="alert"
          className="border-danger bg-danger/10 text-danger rounded-lg border px-3 py-2 text-sm"
        >
          حدث خطأ أثناء تحميل الكلمات. حاول مرة أخرى.
        </p>
      ) : null}

      {pending ? (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          aria-hidden="true"
        >
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="border-border bg-surface-muted h-28 animate-pulse rounded-2xl border"
            />
          ))}
        </div>
      ) : result.rows.length === 0 ? (
        <p className="border-border bg-surface-muted text-foreground/60 rounded-xl border px-4 py-8 text-center text-sm">
          {hasFilters
            ? "لا توجد نتائج مطابقة لبحثك."
            : "لا توجد كلمات معتمدة في هذه اللهجة بعد."}
        </p>
      ) : (
        <ul
          role="list"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {result.rows.map((row) => (
            <WordCardView key={row.id} row={row} />
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={page <= 1 || pending}
            onClick={() => runQuery({ page: page - 1 })}
          >
            السابق
          </Button>
          <span className="text-foreground/70 text-sm">
            صفحة {page} من {totalPages}
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={page >= totalPages || pending}
            onClick={() => runQuery({ page: page + 1 })}
          >
            التالي
          </Button>
        </div>
      ) : null}

      <div className="flex justify-center pt-2">
        <Link
          href="/"
          className="bg-accent text-accent-foreground rounded-xl px-4 py-2.5 text-sm font-semibold hover:opacity-90"
        >
          ساهم بكلمة من هذه اللهجة
        </Link>
      </div>
    </div>
  );
}

function WordCardView({ row }: { row: DialectWordEntry }) {
  return (
    <li className="border-border bg-surface flex flex-col gap-2 rounded-2xl border p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-foreground text-lg font-bold">{row.canonicalWord}</p>
        {row.categoryLabelAr ? (
          <span className="bg-surface-muted text-foreground/60 rounded-full px-2 py-0.5 text-xs font-medium">
            {row.categoryLabelAr}
          </span>
        ) : null}
      </div>
      <p className="text-foreground/70 text-sm">
        المرادف الفصيح: {row.canonicalMsaSynonyms.join("، ")}
      </p>
      {row.canonicalExplanation ? (
        <p className="text-foreground/70 text-sm">{row.canonicalExplanation}</p>
      ) : null}
      {row.examples.length > 0 ? (
        <ul className="border-border text-foreground/80 flex flex-col gap-1 border-t pt-2 text-sm">
          {row.examples.map((ex, i) => (
            <li key={i}>«{ex.sentence}»</li>
          ))}
        </ul>
      ) : null}
      <p className="text-foreground/50 text-xs">
        اللهجة المحلية: {row.localDialectLabel}
      </p>
    </li>
  );
}
