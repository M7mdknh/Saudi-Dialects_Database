"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  bulkAddDictionaryDialect,
  bulkSetDictionaryVisibility,
  listDictionaryEntries,
  type DictionaryEntryRow,
  type ListDictionaryEntriesParams,
} from "./actions";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import type {
  MainDialectGroupCode,
  PublicVisibility,
} from "@/lib/supabase/types";

interface DialectOption {
  id: string;
  name_ar: string;
  main_group_code: MainDialectGroupCode | null;
  parent_id: string | null;
}

const MAIN_GROUP_LABELS_AR: Record<MainDialectGroupCode, string> = {
  hijazi: "حجازي",
  najdi: "نجدي",
  eastern: "شرقاوي",
  northern: "شمالي",
  southern: "جنوبي",
};

const REGISTER_LABELS_AR: Record<string, string> = {
  neutral: "محايد",
  informal: "غير رسمي",
  slang: "عامي",
  offensive: "مسيء",
  taboo: "محظور",
  archaic: "قديم الاستخدام",
};

const SORT_LABELS_AR: Record<
  NonNullable<ListDictionaryEntriesParams["sort"]>,
  string
> = {
  updated_desc: "الأحدث تعديلاً",
  updated_asc: "الأقدم تعديلاً",
  word_asc: "أبجدي تصاعدي",
  word_desc: "أبجدي تنازلي",
};

export function DictionaryTable({
  initialRows,
  initialTotal,
  dialects,
}: {
  initialRows: DictionaryEntryRow[];
  initialTotal: number;
  dialects: DialectOption[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  const [search, setSearch] = useState("");
  const [mainGroupCode, setMainGroupCode] = useState<MainDialectGroupCode | "">(
    "",
  );
  const [localDialectLabel, setLocalDialectLabel] = useState("");
  const [visibility, setVisibility] = useState<PublicVisibility | "">("");
  const [register, setRegister] = useState("");
  const [missingMeaning, setMissingMeaning] = useState(false);
  const [missingExamples, setMissingExamples] = useState(false);
  const [missingConcept, setMissingConcept] = useState(false);
  const [sort, setSort] =
    useState<ListDictionaryEntriesParams["sort"]>("updated_desc");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDialectId, setBulkDialectId] = useState(dialects[0]?.id ?? "");

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function refetch(nextPage = 1) {
    setStatus("loading");
    startTransition(async () => {
      try {
        const result = await listDictionaryEntries({
          page: nextPage,
          search,
          mainGroupCode: mainGroupCode || undefined,
          localDialectLabel: localDialectLabel || undefined,
          visibility: visibility || undefined,
          register: register || undefined,
          missingMeaning: missingMeaning || undefined,
          missingExamples: missingExamples || undefined,
          missingConcept: missingConcept || undefined,
          sort,
        });
        setRows(result.rows);
        setTotal(result.total);
        setPage(nextPage);
        setSelected(new Set());
        setStatus("idle");
      } catch {
        setStatus("error");
      }
    });
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)),
    );
  }

  function handleBulkVisibility(newVisibility: PublicVisibility) {
    startTransition(async () => {
      try {
        await bulkSetDictionaryVisibility([...selected], newVisibility);
        refetch(page);
      } catch {
        setStatus("error");
      }
    });
  }

  function handleBulkAddDialect() {
    if (!bulkDialectId) return;
    startTransition(async () => {
      try {
        await bulkAddDictionaryDialect([...selected], bulkDialectId);
        refetch(page);
      } catch {
        setStatus("error");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">القاموس المعتمد</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          refetch(1);
        }}
        className="border-border bg-surface flex flex-col gap-3 rounded-2xl border p-4"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="dict-search" label="بحث">
            <input
              id="dict-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
              placeholder="الكلمة، المفتاح، المعنى، مثال، مفهوم، لهجة محلية"
            />
          </Field>
          <Field id="dict-main-group" label="اللهجة الرئيسية">
            <select
              id="dict-main-group"
              value={mainGroupCode}
              onChange={(e) =>
                setMainGroupCode(e.target.value as MainDialectGroupCode | "")
              }
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            >
              <option value="">الكل</option>
              {(
                Object.keys(MAIN_GROUP_LABELS_AR) as MainDialectGroupCode[]
              ).map((g) => (
                <option key={g} value={g}>
                  {MAIN_GROUP_LABELS_AR[g]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="dict-local-dialect" label="اللهجة المحلية">
            <input
              id="dict-local-dialect"
              value={localDialectLabel}
              onChange={(e) => setLocalDialectLabel(e.target.value)}
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            />
          </Field>
          <Field id="dict-visibility" label="الظهور">
            <select
              id="dict-visibility"
              value={visibility}
              onChange={(e) =>
                setVisibility(e.target.value as PublicVisibility | "")
              }
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            >
              <option value="">الكل</option>
              <option value="public">عام</option>
              <option value="private">خاص</option>
            </select>
          </Field>
          <Field id="dict-register" label="السجل اللغوي">
            <select
              id="dict-register"
              value={register}
              onChange={(e) => setRegister(e.target.value)}
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            >
              <option value="">الكل</option>
              {Object.entries(REGISTER_LABELS_AR).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="dict-sort" label="الترتيب">
            <select
              id="dict-sort"
              value={sort}
              onChange={(e) =>
                setSort(e.target.value as ListDictionaryEntriesParams["sort"])
              }
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            >
              {Object.entries(SORT_LABELS_AR).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={missingMeaning}
              onChange={(e) => setMissingMeaning(e.target.checked)}
            />
            بلا معنى
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={missingExamples}
              onChange={(e) => setMissingExamples(e.target.checked)}
            />
            بلا أمثلة
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={missingConcept}
              onChange={(e) => setMissingConcept(e.target.checked)}
            />
            بلا مفهوم
          </label>
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "جارٍ البحث…" : "تطبيق الفلاتر"}
        </Button>
      </form>

      {selected.size > 0 ? (
        <div className="border-border bg-surface-muted flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm">
          <span className="font-semibold">{selected.size} محدَّدة</span>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => handleBulkVisibility("public")}
          >
            تعيين عام
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => handleBulkVisibility("private")}
          >
            تعيين خاص
          </Button>
          <select
            value={bulkDialectId}
            onChange={(e) => setBulkDialectId(e.target.value)}
            className="border-border bg-surface min-h-9 rounded-lg border px-2"
          >
            {dialects.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name_ar}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={handleBulkAddDialect}
          >
            إضافة هذه اللهجة للمحدَّد
          </Button>
        </div>
      ) : null}

      {status === "error" ? (
        <p role="alert" className="text-danger text-sm">
          تعذّر تحميل القاموس. حاول مرة أخرى.
        </p>
      ) : null}

      {rows.length === 0 && status !== "loading" ? (
        <p className="text-foreground/60 text-center">
          لا توجد كلمات تطابق الفلاتر الحالية.
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="border-border overflow-x-auto rounded-2xl border">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-surface-muted">
              <tr>
                <th className="p-2">
                  <input
                    type="checkbox"
                    checked={selected.size === rows.length && rows.length > 0}
                    onChange={toggleSelectAll}
                    aria-label="تحديد الكل"
                  />
                </th>
                <th className="p-2 text-start">الكلمة</th>
                <th className="p-2 text-start">المفتاح</th>
                <th className="p-2 text-start">المعنى</th>
                <th className="p-2 text-start">اللهجات</th>
                <th className="p-2 text-start">السجل</th>
                <th className="p-2 text-start">الظهور</th>
                <th className="p-2 text-start">أمثلة</th>
                <th className="p-2 text-start"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-border border-t">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleSelected(row.id)}
                      aria-label={`تحديد ${row.word}`}
                    />
                  </td>
                  <td className="p-2 font-semibold">{row.word}</td>
                  <td className="text-foreground/60 p-2" dir="ltr">
                    {row.wordKey}
                  </td>
                  <td className="max-w-xs truncate p-2">
                    {row.meaning || "—"}
                  </td>
                  <td className="p-2">
                    {row.mainGroupCodes
                      .map((g) => MAIN_GROUP_LABELS_AR[g])
                      .join("، ") || "—"}
                    {row.localDialectLabels.length > 0
                      ? ` (${row.localDialectLabels.join("، ")})`
                      : ""}
                  </td>
                  <td className="p-2">
                    {row.register ? REGISTER_LABELS_AR[row.register] : "—"}
                  </td>
                  <td className="p-2">
                    {row.visibility === "public" ? "عام" : "خاص"}
                  </td>
                  <td className="p-2">{row.exampleCount}</td>
                  <td className="p-2">
                    <Link
                      href={`/admin/dictionary/${row.id}`}
                      className="text-accent font-semibold hover:underline"
                    >
                      تحرير
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {total > pageSize ? (
        <div className="flex items-center justify-center gap-3">
          <Button
            type="button"
            variant="ghost"
            disabled={page <= 1 || pending}
            onClick={() => refetch(page - 1)}
          >
            السابق
          </Button>
          <span className="text-sm">
            صفحة {page} من {totalPages}
          </span>
          <Button
            type="button"
            variant="ghost"
            disabled={page >= totalPages || pending}
            onClick={() => refetch(page + 1)}
          >
            التالي
          </Button>
        </div>
      ) : null}
    </div>
  );
}
