"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  listDuplicateGroups,
  resolveDuplicateGroup,
  type DuplicateGroupRow,
  type ListDuplicateGroupsParams,
} from "./actions";
import {
  CANDIDATE_TYPE_LABELS_AR,
  MAIN_GROUP_LABELS_AR,
  RESOLUTION_STATUS_LABELS_AR,
  SORT_LABELS_AR,
} from "./labels";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import type {
  DuplicateCandidateType,
  DuplicateGroupStatus,
  MainDialectGroupCode,
} from "@/lib/supabase/types";

interface Summary {
  unresolvedGroups: number;
  exactMatchGroups: number;
  possibleMatchGroups: number;
  totalSourceRecords: number;
}

export function DuplicateCenter({
  initialRows,
  initialTotal,
  initialSummary,
}: {
  initialRows: DuplicateGroupRow[];
  initialTotal: number;
  initialSummary: Summary;
}) {
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [summary, setSummary] = useState(initialSummary);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [candidateType, setCandidateType] = useState<
    DuplicateCandidateType | ""
  >("");
  const [mainGroupCode, setMainGroupCode] = useState<MainDialectGroupCode | "">(
    "",
  );
  const [minCandidates, setMinCandidates] = useState("");
  const [resolutionStatus, setResolutionStatus] = useState<
    DuplicateGroupStatus | ""
  >("unresolved");
  const [sort, setSort] = useState<ListDuplicateGroupsParams["sort"]>("newest");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [pending, startTransition] = useTransition();

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function refetch(nextPage = 1) {
    setStatus("loading");
    startTransition(async () => {
      try {
        const [result] = await Promise.all([
          listDuplicateGroups({
            page: nextPage,
            search,
            candidateType: candidateType || undefined,
            mainGroupCode: mainGroupCode || undefined,
            minCandidates: minCandidates ? Number(minCandidates) : undefined,
            resolutionStatus: resolutionStatus || undefined,
            sort,
          }),
        ]);
        setRows(result.rows);
        setTotal(result.total);
        setPage(nextPage);
        setStatus("idle");
      } catch {
        setStatus("error");
      }
    });
  }

  async function refreshSummary() {
    const { getDuplicateSummary } = await import("./actions");
    try {
      setSummary(await getDuplicateSummary());
    } catch {
      // summary refresh failure is non-fatal — the list itself still updates
    }
  }

  function handleQuickResolve(
    row: DuplicateGroupRow,
    newStatus: "not_duplicate" | "ignored",
  ) {
    startTransition(async () => {
      try {
        await resolveDuplicateGroup(
          row.groupKey,
          newStatus,
          row.memberSignature,
        );
        setRows((prev) => prev.filter((r) => r.groupKey !== row.groupKey));
        setTotal((t) => Math.max(0, t - 1));
        await refreshSummary();
      } catch {
        setStatus("error");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">مركز إدارة التكرارات</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile
          label="مجموعات غير محسومة"
          value={summary.unresolvedGroups}
        />
        <SummaryTile
          label="مجموعات تطابق مباشر"
          value={summary.exactMatchGroups}
        />
        <SummaryTile
          label="مجموعات تشابه محتمل"
          value={summary.possibleMatchGroups}
        />
        <SummaryTile
          label="سجلات مصدر متضمّنة"
          value={summary.totalSourceRecords}
        />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          refetch(1);
        }}
        className="border-border bg-surface flex flex-col gap-3 rounded-2xl border p-4"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="dup-search" label="بحث">
            <input
              id="dup-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
              placeholder="الكلمة أو المفتاح"
            />
          </Field>
          <Field id="dup-type" label="نوع التطابق">
            <select
              id="dup-type"
              value={candidateType}
              onChange={(e) =>
                setCandidateType(e.target.value as DuplicateCandidateType | "")
              }
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            >
              <option value="">الكل</option>
              {(
                Object.keys(
                  CANDIDATE_TYPE_LABELS_AR,
                ) as DuplicateCandidateType[]
              ).map((t) => (
                <option key={t} value={t}>
                  {CANDIDATE_TYPE_LABELS_AR[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="dup-main-group" label="اللهجة الرئيسية">
            <select
              id="dup-main-group"
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
          <Field id="dup-min-candidates" label="أقل عدد للمرشحين">
            <input
              id="dup-min-candidates"
              type="number"
              min={2}
              value={minCandidates}
              onChange={(e) => setMinCandidates(e.target.value)}
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            />
          </Field>
          <Field id="dup-status" label="حالة الحسم">
            <select
              id="dup-status"
              value={resolutionStatus}
              onChange={(e) =>
                setResolutionStatus(e.target.value as DuplicateGroupStatus | "")
              }
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            >
              <option value="">الكل</option>
              {(
                Object.keys(
                  RESOLUTION_STATUS_LABELS_AR,
                ) as DuplicateGroupStatus[]
              ).map((s) => (
                <option key={s} value={s}>
                  {RESOLUTION_STATUS_LABELS_AR[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="dup-sort" label="الترتيب">
            <select
              id="dup-sort"
              value={sort}
              onChange={(e) =>
                setSort(e.target.value as ListDuplicateGroupsParams["sort"])
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
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "جارٍ البحث…" : "تطبيق الفلاتر"}
        </Button>
      </form>

      {status === "error" ? (
        <p role="alert" className="text-danger text-sm">
          تعذّر تحميل المجموعات. حاول مرة أخرى.
        </p>
      ) : null}

      {rows.length === 0 && status !== "loading" ? (
        <p className="text-foreground/60 text-center">
          لا توجد مجموعات تطابق الفلاتر الحالية.
        </p>
      ) : null}

      <ul className="flex flex-col gap-3" data-testid="duplicate-groups-list">
        {rows.map((row) => (
          <li
            key={row.groupKey}
            className="border-border bg-surface flex flex-col gap-2 rounded-2xl border p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold">{row.word}</span>
                <span className="bg-surface-muted rounded-full px-2 py-0.5 text-xs font-semibold">
                  {CANDIDATE_TYPE_LABELS_AR[row.candidateType]}
                </span>
                <span className="text-foreground/60 text-xs">
                  {row.candidateCount} مرشّحين
                </span>
              </div>
              <span className="text-foreground/60 text-xs">
                {RESOLUTION_STATUS_LABELS_AR[row.resolutionStatus]}
              </span>
            </div>
            <p className="text-foreground/70 text-sm">
              اللهجات:{" "}
              {row.mainGroupCodes
                .map((g) => MAIN_GROUP_LABELS_AR[g])
                .join("، ") || "—"}
              {row.localDialectLabels.length > 0
                ? ` (${row.localDialectLabels.join("، ")})`
                : ""}
            </p>
            {row.meanings.length > 0 ? (
              <p className="text-foreground/70 text-sm">
                المعاني: {row.meanings.join(" / ")}
              </p>
            ) : null}
            <p className="text-foreground/60 text-xs">
              أمثلة: {row.exampleCount} · حالة الكيان المعتمد:{" "}
              {row.hasCanonical
                ? row.canonicalStatus === "approved"
                  ? "موجود ومعتمد"
                  : (row.canonicalStatus ?? "—")
                : "لا يوجد بعد"}{" "}
              · الظهور:{" "}
              {row.publicVisibility === "private"
                ? "خاص"
                : row.publicVisibility === "public"
                  ? "عام"
                  : "—"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link
                href={`/admin/duplicates/${encodeURIComponent(row.groupKey)}`}
              >
                <Button type="button">فتح مساحة الدمج</Button>
              </Link>
              {row.resolutionStatus === "unresolved" ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => handleQuickResolve(row, "not_duplicate")}
                  >
                    ليست مكررة
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => handleQuickResolve(row, "ignored")}
                  >
                    تجاهل حالياً
                  </Button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

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

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-border bg-surface-muted rounded-xl border p-3 text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-foreground/60 text-xs">{label}</p>
    </div>
  );
}
