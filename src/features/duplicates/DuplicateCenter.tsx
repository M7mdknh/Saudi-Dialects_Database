"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  getAutoMergeableDuplicateCount,
  listDuplicateGroups,
  resolveDuplicateGroup,
  retryAutoMergeGroups,
  runAutoMergeBatch,
  type AutoMergeFailure,
  type DuplicateGroupRow,
  type ListDuplicateGroupsParams,
} from "./actions";
import {
  accumulateAutoMergeProgress,
  AUTO_MERGE_BATCH_SIZE,
  shouldRequestNextAutoMergeBatch,
} from "./auto-merge-rules";
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
  initialAutoMergeableCount,
}: {
  initialRows: DuplicateGroupRow[];
  initialTotal: number;
  initialSummary: Summary;
  initialAutoMergeableCount: number;
}) {
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [summary, setSummary] = useState(initialSummary);
  const [autoMergeableCount, setAutoMergeableCount] = useState(
    initialAutoMergeableCount,
  );
  const [autoMergeStatus, setAutoMergeStatus] = useState<
    "idle" | "confirming" | "running" | "done" | "error"
  >("idle");
  const [autoMergeProgress, setAutoMergeProgress] = useState<{
    total: number;
    merged: number;
    skipped: number;
    failed: number;
    remaining: number;
  } | null>(null);
  const [autoMergeFailures, setAutoMergeFailures] = useState<
    AutoMergeFailure[]
  >([]);
  const [autoMergeErrorMessage, setAutoMergeErrorMessage] = useState("");
  const [retryingFailed, setRetryingFailed] = useState(false);
  const autoMergeCancelledRef = useRef(false);

  useEffect(
    () => () => {
      autoMergeCancelledRef.current = true;
    },
    [],
  );
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

  function handleAutoMergeClick() {
    setAutoMergeStatus("confirming");
  }

  function confirmAutoMerge() {
    setAutoMergeStatus("running");
    setAutoMergeErrorMessage("");
    setAutoMergeFailures([]);
    startTransition(async () => {
      const totalAtStart = autoMergeableCount;
      let progress = {
        total: totalAtStart,
        merged: 0,
        skipped: 0,
        failed: 0,
        remaining: totalAtStart,
      };
      const failures: AutoMergeFailure[] = [];
      setAutoMergeProgress(progress);

      try {
        // Bounded batches only — never one request for the whole backlog
        // (see migration 0032's fix for the production timeout incident).
        // Loops until nothing is left to claim, updating visible progress
        // after every batch so a long run never looks like one silent hang.
        for (;;) {
          if (autoMergeCancelledRef.current) return;
          const batch = await runAutoMergeBatch(AUTO_MERGE_BATCH_SIZE);
          progress = accumulateAutoMergeProgress(progress, batch);
          failures.push(...batch.failedGroups);

          if (autoMergeCancelledRef.current) return;
          setAutoMergeProgress(progress);
          setAutoMergeFailures([...failures]);

          if (!shouldRequestNextAutoMergeBatch(batch)) break;
        }

        if (autoMergeCancelledRef.current) return;
        setAutoMergeStatus("done");
        refetch(1);
        await refreshSummary();
        try {
          setAutoMergeableCount(await getAutoMergeableDuplicateCount());
        } catch {
          // non-fatal — the progress summary already reflects what happened
        }
      } catch (error) {
        if (autoMergeCancelledRef.current) return;
        setAutoMergeStatus("error");
        setAutoMergeErrorMessage(
          (error as { message?: string })?.message ??
            "تعذّر تنفيذ الدمج التلقائي.",
        );
      }
    });
  }

  function handleRetryFailedAutoMerge() {
    const groupKeys = autoMergeFailures.map((f) => f.groupKey);
    if (groupKeys.length === 0) return;
    setRetryingFailed(true);
    startTransition(async () => {
      try {
        const { outcomes, failedGroups } =
          await retryAutoMergeGroups(groupKeys);
        const nowMerged = outcomes.filter((o) => o.merged).length;
        setAutoMergeProgress((prev) =>
          prev
            ? {
                ...prev,
                merged: prev.merged + nowMerged,
                failed: prev.failed - groupKeys.length + failedGroups.length,
              }
            : prev,
        );
        setAutoMergeFailures(failedGroups);
        refetch(1);
        await refreshSummary();
        setAutoMergeableCount(await getAutoMergeableDuplicateCount());
      } catch {
        // The failed-groups list is left as-is; the admin can retry again.
      } finally {
        setRetryingFailed(false);
      }
    });
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

      <div
        className="border-border bg-surface flex flex-col gap-3 rounded-2xl border p-4"
        data-testid="auto-merge-panel"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            الحالات الواضحة المؤهلة للدمج التلقائي حاليًا:{" "}
            <span className="font-bold" data-testid="auto-merge-eligible-count">
              {autoMergeableCount}
            </span>
          </p>
          {autoMergeStatus === "idle" ||
          autoMergeStatus === "error" ||
          autoMergeStatus === "done" ? (
            <Button
              type="button"
              variant="secondary"
              disabled={autoMergeableCount === 0}
              onClick={handleAutoMergeClick}
            >
              دمج الحالات الواضحة تلقائيًا
            </Button>
          ) : null}
        </div>

        {autoMergeStatus === "confirming" ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm">
              ستتم معالجة {autoMergeableCount} مجموعة على دفعات من{" "}
              {AUTO_MERGE_BATCH_SIZE} مجموعة. المجموعات ذات تعارض في المعنى أو
              المفهوم تبقى في قائمة المراجعة اليدوية. متابعة؟
            </p>
            <Button type="button" onClick={confirmAutoMerge}>
              تأكيد
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAutoMergeStatus("idle")}
            >
              إلغاء
            </Button>
          </div>
        ) : null}

        {autoMergeStatus === "running" && autoMergeProgress ? (
          <div
            className="flex flex-col gap-2"
            data-testid="auto-merge-progress"
          >
            <p className="text-sm" aria-live="polite">
              تم دمج {autoMergeProgress.merged} من {autoMergeProgress.total}
              {" — "}
              المتبقي: {autoMergeProgress.remaining}
            </p>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={autoMergeProgress.total}
              aria-valuenow={autoMergeProgress.merged}
              className="bg-surface-muted h-2 w-full overflow-hidden rounded-full"
            >
              <div
                className="bg-accent h-full transition-all"
                style={{
                  width: `${
                    autoMergeProgress.total > 0
                      ? Math.min(
                          100,
                          (autoMergeProgress.merged / autoMergeProgress.total) *
                            100,
                        )
                      : 100
                  }%`,
                }}
              />
            </div>
          </div>
        ) : null}

        {autoMergeStatus === "done" && autoMergeProgress ? (
          <div className="flex flex-col gap-2" data-testid="auto-merge-summary">
            <p className="text-sm">
              اكتملت المعالجة: تم دمج {autoMergeProgress.merged}، تم تجاوز{" "}
              {autoMergeProgress.skipped} لعدم توفر الأهلية
              {autoMergeProgress.failed > 0
                ? `، وفشل ${autoMergeProgress.failed}`
                : ""}
              {autoMergeProgress.remaining > 0
                ? ` (لا يزال ${autoMergeProgress.remaining} بحاجة لمراجعة يدوية أو إعادة محاولة)`
                : ""}
              .
            </p>
            {autoMergeFailures.length > 0 ? (
              <div className="border-danger/40 bg-danger/5 flex flex-col gap-2 rounded-xl border p-3">
                <p className="text-sm font-semibold">
                  المجموعات التي فشلت ({autoMergeFailures.length}):
                </p>
                <ul className="flex flex-col gap-1">
                  {autoMergeFailures.map((f) => (
                    <li key={f.groupKey} className="text-xs">
                      <Link
                        href={`/admin/duplicates/${encodeURIComponent(f.groupKey)}`}
                        className="text-accent underline"
                      >
                        {f.groupKey}
                      </Link>{" "}
                      — {f.reason} (رمز المرجع: {f.referenceId})
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={retryingFailed}
                  onClick={handleRetryFailedAutoMerge}
                >
                  {retryingFailed
                    ? "جارٍ إعادة المحاولة…"
                    : "إعادة محاولة الحالات الفاشلة"}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {autoMergeStatus === "error" ? (
          <p role="alert" className="text-danger text-sm">
            {autoMergeErrorMessage ||
              "تعذّر تنفيذ الدمج التلقائي. حاول مرة أخرى."}
          </p>
        ) : null}
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
                {row.autoMergeable ? (
                  <span className="bg-accent/10 text-accent rounded-full px-2 py-0.5 text-xs font-semibold">
                    قابلة للدمج التلقائي
                  </span>
                ) : null}
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
