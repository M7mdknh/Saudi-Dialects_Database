"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { STATUS_LABELS_AR, REVIEW_STATUS_FILTERS } from "./status-labels";
import {
  bulkApproveWithSubmittedDialects,
  bulkSetCanonicalVisibility,
  bulkSetParticipationExclusion,
  bulkSetReviewStatus,
  bulkSetSubmissionMainGroup,
  classifyWithSubmittedDialects,
  previewBulkApproval,
} from "./actions";
import {
  computeReadiness,
  formatBulkClassifyMessage,
  formatBulkExecutionMessage,
  formatHardFailureMessage,
  formatReadinessSummary,
  type NeedsAttentionReason,
} from "./bulk-approve";
import { Button } from "@/components/ui/Button";
import type {
  MainDialectGroupCode,
  ParticipationExclusionReason,
  PublicVisibility,
  ReviewStatus,
} from "@/lib/supabase/types";

const MAIN_GROUP_LABELS: Record<MainDialectGroupCode, string> = {
  hijazi: "حجازي",
  najdi: "نجدي",
  eastern: "شرقاوي",
  northern: "شمالي",
  southern: "جنوبي",
};

const EXCLUSION_REASON_LABELS: Record<ParticipationExclusionReason, string> = {
  spam: "سبام",
  abuse: "إساءة استخدام",
  test: "بيانات اختبار",
  duplicate: "تكرار غير مقصود",
  invalid_submission: "مساهمة غير صالحة",
};

const NEEDS_ATTENTION_REASON_LABELS: Record<
  NeedsAttentionReason | "stale",
  string
> = {
  empty_label: "لا توجد لهجة مُدخلة",
  group_conflict: "اللهجة المُدخلة تتبع مجموعة رئيسية أخرى",
  ambiguous: "اللهجة المُدخلة تطابق أكثر من لهجة محلية",
  invalid_trusted_dialect: "اللهجة المختارة لم تعد متاحة",
  missing_classification: "لا تحمل تصنيفًا مبدئيًا — تحتاج اختيارًا يدويًا",
  stale: "تغيّر السجل من قبل مشرف آخر",
};

interface ExampleRow {
  id: string;
  sentence: string;
}

interface PrimaryCanonicalLink {
  relation: string;
  canonical_entries: {
    id: string;
    public_visibility: PublicVisibility;
    version: number;
  } | null;
}

interface SubmissionRow {
  id: string;
  submitted_word: string;
  submitted_dialect: string;
  submitted_msa_synonym: string | null;
  review_status: ReviewStatus;
  created_at: string;
  updated_at: string;
  raw_examples: ExampleRow[];
  participation_exclusion_reason: ParticipationExclusionReason | null;
  selected_dialect_id: string | null;
  provisional_main_group_code: MainDialectGroupCode | null;
  admin_confirmed_main_group_code: MainDialectGroupCode | null;
  entry_sources?: PrimaryCanonicalLink[];
}

interface DialectOption {
  id: string;
  name_ar: string;
}

interface ReviewGridProps {
  rows: SubmissionRow[];
  total: number;
  page: number;
  pageSize: number;
  status?: ReviewStatus;
  visibility?: PublicVisibility;
  search?: string;
  dialects: DialectOption[];
}

function primaryCanonicalLink(row: SubmissionRow) {
  return (
    row.entry_sources?.find((es) => es.relation === "primary")
      ?.canonical_entries ?? null
  );
}

export function ReviewGrid({
  rows,
  total,
  page,
  pageSize,
  status,
  visibility,
  search,
  dialects,
}: ReviewGridProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [exclusionReason, setExclusionReason] = useState<
    ParticipationExclusionReason | ""
  >("");
  const [bulkMainGroup, setBulkMainGroup] = useState<MainDialectGroupCode | "">(
    "",
  );
  const [plan, setPlan] = useState<Awaited<
    ReturnType<typeof previewBulkApproval>
  > | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState<
    "approve_public" | "approve_private" | "classify" | null
  >(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function updateParams(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Keep any stale override for a row that just left the selection, but
    // drop the plan so it recomputes against the new selection.
    setPlan(null);
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)),
    );
    setPlan(null);
  }

  function clearSelectionState() {
    setSelected(new Set());
    setPlan(null);
    setOverrides({});
  }

  function runBulk(action: () => Promise<unknown>, successMessage: string) {
    startTransition(async () => {
      try {
        await action();
        setMessage(successMessage);
        clearSelectionState();
        router.refresh();
      } catch {
        setMessage("تعذّر تنفيذ الإجراء. حاول مرة أخرى.");
      }
    });
  }

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  // Recompute the automatic-classification preview (per-row resolution,
  // never a global batch group) whenever the selection changes — this is
  // the fix for the buttons-stay-disabled regression: readiness no longer
  // depends on any admin-chosen group, only on the selection itself.
  useEffect(() => {
    if (selectedIds.length === 0) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    previewBulkApproval(selectedIds).then((result) => {
      if (!cancelled) setPlan(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.join(",")]);

  const readiness = useMemo(() => {
    if (!plan) return null;
    const base = computeReadiness(plan);
    const overriddenUnresolved = plan.rowPlans.filter(
      (r) => r.kind === "needs_attention" && overrides[r.submissionId],
    ).length;
    return {
      total: base.total,
      ready: base.ready + overriddenUnresolved,
      needsAttention: base.needsAttention - overriddenUnresolved,
    };
  }, [plan, overrides]);

  // The only gate on the quick-approval/classify buttons: a selection
  // exists, the preview has resolved, and at least one row is actually
  // resolvable. No global main-group dropdown involved.
  const canActOnReadyRows = Boolean(
    plan && readiness && readiness.ready > 0 && !pending,
  );

  /** Keeps unresolved/conflicting/failed rows selected (and their overrides) so the admin can fix or retry immediately; drops only the rows the batch actually finished successfully. */
  function reconcileAfterBatch(
    rows: { submissionId: string; status: string }[],
  ) {
    const remaining = new Set(
      rows.filter((r) => r.status !== "approved").map((r) => r.submissionId),
    );
    setSelected(remaining);
    setOverrides((prev) => {
      const next: Record<string, string> = {};
      for (const id of remaining) if (prev[id]) next[id] = prev[id];
      return next;
    });
    setPlan(null);
  }

  function runFastApproval(publish: boolean) {
    if (!plan || !readiness || readiness.ready === 0) return;
    if (readiness.total >= 20 && !confirm(`اعتماد ${readiness.ready} كلمة؟`)) {
      return;
    }
    setActionInFlight(publish ? "approve_public" : "approve_private");
    startTransition(async () => {
      const outcome = await bulkApproveWithSubmittedDialects(
        selectedIds,
        publish ? "public" : "private",
        overrides,
      );
      setActionInFlight(null);
      if (outcome.hardFailure) {
        setMessage(
          formatHardFailureMessage(
            outcome.hardFailure.category,
            outcome.hardFailure.correlationId,
          ),
        );
        // A hard failure means the RPC never ran: nothing changed, so every
        // requested row stays selected exactly as it was.
        return;
      }
      setMessage(
        formatBulkExecutionMessage(outcome, publish ? "public" : "private"),
      );
      reconcileAfterBatch(outcome.rows);
      router.refresh();
    });
  }

  function runClassifyOnly() {
    if (!plan || !readiness || readiness.ready === 0) return;
    setActionInFlight("classify");
    startTransition(async () => {
      const outcome = await classifyWithSubmittedDialects(
        selectedIds,
        overrides,
      );
      setActionInFlight(null);
      if (outcome.hardFailure) {
        setMessage(
          formatHardFailureMessage(
            outcome.hardFailure.category,
            outcome.hardFailure.correlationId,
          ),
        );
        return;
      }
      setMessage(formatBulkClassifyMessage(outcome));
      reconcileAfterBatch(outcome.rows);
      router.refresh();
    });
  }

  const isApprovedView = status === "approved";
  const approvedEntryIds = useMemo(
    () =>
      selectedIds
        .map((id) => rows.find((r) => r.id === id))
        .map((r) => (r ? primaryCanonicalLink(r) : null))
        .filter((link): link is NonNullable<typeof link> => Boolean(link))
        .map((link) => link.id),
    [selectedIds, rows],
  );

  function rowPlanFor(submissionId: string) {
    return plan?.rowPlans.find((r) => r.submissionId === submissionId) ?? null;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          defaultValue={search ?? ""}
          placeholder="ابحث بالكلمة أو اللهجة"
          className="border-border bg-surface min-h-11 min-w-48 rounded-lg border px-3 py-2"
          onKeyDown={(e) => {
            if (e.key === "Enter")
              updateParams({
                q: (e.target as HTMLInputElement).value,
                page: undefined,
              });
          }}
        />
        <select
          value={
            status === "approved" && visibility
              ? `approved_${visibility}`
              : (status ?? "")
          }
          onChange={(e) => {
            const value = e.target.value;
            if (value === "approved_public" || value === "approved_private") {
              updateParams({
                status: "approved",
                visibility: value === "approved_public" ? "public" : "private",
                page: undefined,
              });
              return;
            }
            updateParams({
              status: value || undefined,
              visibility: undefined,
              page: undefined,
            });
          }}
          className="border-border bg-surface min-h-11 rounded-lg border px-3 py-2"
          aria-label="تصفية حسب الحالة"
        >
          <option value="">كل الحالات</option>
          {REVIEW_STATUS_FILTERS.filter((s) => s !== "approved").map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS_AR[s]}
            </option>
          ))}
          <option value="approved_public">معتمد ومنشور</option>
          <option value="approved_private">معتمد وغير منشور</option>
        </select>
      </div>

      {selectedIds.length > 0 ? (
        <div className="border-accent bg-accent/10 flex flex-col gap-3 rounded-xl border p-3">
          <span className="text-sm font-medium">
            تم تحديد {selectedIds.length} سجل
          </span>

          {actionInFlight ? (
            <p role="status" className="text-foreground text-sm font-medium">
              {actionInFlight === "classify"
                ? `جارٍ تصنيف ${readiness?.ready ?? selectedIds.length} كلمة…`
                : `جارٍ اعتماد ${readiness?.ready ?? selectedIds.length} كلمة…`}
            </p>
          ) : readiness ? (
            <p role="status" className="text-sm font-medium">
              {formatReadinessSummary(readiness)}
            </p>
          ) : plan === null && selectedIds.length > 0 ? (
            <p className="text-foreground/60 text-sm">جارٍ تحليل التصنيف…</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={!canActOnReadyRows}
              onClick={() => runFastApproval(true)}
            >
              اعتماد ونشر
              {readiness && readiness.ready < readiness.total
                ? ` (${readiness.ready})`
                : ""}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!canActOnReadyRows}
              onClick={() => runFastApproval(false)}
              title="يبقى معتمدًا وقابلاً للتصدير، لكن لا يظهر في أي صفحة عامة"
            >
              اعتماد بدون نشر
              {readiness && readiness.ready < readiness.total
                ? ` (${readiness.ready})`
                : ""}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!canActOnReadyRows}
              onClick={runClassifyOnly}
              title="يصنّف فقط باستخدام اللهجات المدخلة — بلا اعتماد"
            >
              تصنيف باستخدام اللهجات المدخلة
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={pending}
              onClick={() => {
                if (!confirm(`رفض ${selectedIds.length} سجل؟`)) return;
                runBulk(
                  () => bulkSetReviewStatus(selectedIds, "rejected"),
                  "تم الرفض.",
                );
              }}
            >
              رفض
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                runBulk(
                  () => bulkSetReviewStatus(selectedIds, "duplicate"),
                  "تم التمييز كمكرر.",
                )
              }
            >
              تمييز كمكرر
            </Button>
          </div>

          {plan
            ? plan.rowPlans
                .filter((r) => r.kind === "needs_attention")
                .map((r) => {
                  const overridden = overrides[r.submissionId];
                  return (
                    <div
                      key={r.submissionId}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span
                        className={
                          overridden ? "text-foreground/60" : "text-danger"
                        }
                      >
                        «{r.label || "بلا لهجة"}» —{" "}
                        {overridden
                          ? "تم تجاوزها يدويًا"
                          : NEEDS_ATTENTION_REASON_LABELS[r.reason]}
                      </span>
                      <select
                        className="border-border bg-surface min-h-8 rounded-lg border px-2 text-xs"
                        aria-label={`اختيار لهجة يدويًا لـ ${r.label || r.submissionId}`}
                        value={overridden ?? ""}
                        onChange={(e) => {
                          setOverrides((prev) => {
                            if (!e.target.value) {
                              const next = { ...prev };
                              delete next[r.submissionId];
                              return next;
                            }
                            return {
                              ...prev,
                              [r.submissionId]: e.target.value,
                            };
                          });
                        }}
                      >
                        <option value="">اختر لهجة يدويًا</option>
                        {dialects.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name_ar}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })
            : null}

          {isApprovedView && approvedEntryIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  runBulk(
                    () =>
                      bulkSetCanonicalVisibility(approvedEntryIds, "public"),
                    "تم الإظهار للعامة.",
                  )
                }
              >
                إظهار المحدد للعامة
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  runBulk(
                    () =>
                      bulkSetCanonicalVisibility(approvedEntryIds, "private"),
                    "تم إخفاء المحدد عن العامة.",
                  )
                }
              >
                إخفاء المحدد عن العامة
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={bulkMainGroup}
              onChange={(e) =>
                setBulkMainGroup(e.target.value as MainDialectGroupCode | "")
              }
              className="border-border bg-surface min-h-9 rounded-lg border px-2 text-sm"
              aria-label="المجموعة الرئيسية للمشاركة (لوحة الصدارة)"
            >
              <option value="">مجموعة المشاركة الرئيسية</option>
              {Object.entries(MAIN_GROUP_LABELS).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary"
              disabled={pending || !bulkMainGroup}
              title="ينقل احتساب المشاركة في لوحة الصدارة فورًا — منفصل عن تصنيف الكلمة المعتمدة"
              onClick={() =>
                runBulk(
                  () =>
                    bulkSetSubmissionMainGroup(
                      selectedIds,
                      bulkMainGroup as MainDialectGroupCode,
                    ),
                  "تم نقل احتساب المشاركة.",
                )
              }
            >
              تصنيف مجموعة المشاركة
            </Button>

            <select
              value={exclusionReason}
              onChange={(e) =>
                setExclusionReason(
                  e.target.value as ParticipationExclusionReason | "",
                )
              }
              className="border-border bg-surface min-h-9 rounded-lg border px-2 text-sm"
              aria-label="سبب الاستبعاد من احتساب المشاركة"
            >
              <option value="">سبب الاستبعاد</option>
              {Object.entries(EXCLUSION_REASON_LABELS).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="danger"
              disabled={pending || !exclusionReason}
              onClick={() =>
                runBulk(
                  () =>
                    bulkSetParticipationExclusion(
                      selectedIds,
                      exclusionReason as ParticipationExclusionReason,
                    ),
                  "تم الاستبعاد من احتساب المشاركة.",
                )
              }
            >
              استبعاد من الاحتساب
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                runBulk(
                  () => bulkSetParticipationExclusion(selectedIds, null),
                  "أُعيد احتساب المشاركة.",
                )
              }
            >
              إلغاء الاستبعاد
            </Button>

            {selectedIds.length >= 2 ? (
              <Link
                href={`/admin/merge?ids=${selectedIds.join(",")}`}
                className="border-border hover:bg-surface-muted min-h-9 rounded-lg border px-3 py-1.5 text-sm font-semibold"
              >
                فتح مساحة الدمج
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {message ? (
        <p
          role="status"
          className="text-foreground/70 text-sm whitespace-pre-line"
        >
          {message}
        </p>
      ) : null}

      <div
        className="border-border overflow-x-auto rounded-xl border"
        dir="rtl"
      >
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-border bg-surface-muted border-b text-right">
              <th className="w-10 resize-x overflow-hidden p-2">
                <input
                  type="checkbox"
                  checked={rows.length > 0 && selected.size === rows.length}
                  onChange={toggleAll}
                  aria-label="تحديد الكل"
                />
              </th>
              <SortableHeader label="الكلمة" sortKey="submitted_word" />
              <SortableHeader
                label="اللهجة المُدخلة"
                sortKey="submitted_dialect"
              />
              <th className="resize-x overflow-hidden p-2">التصنيف التلقائي</th>
              <th className="resize-x overflow-hidden p-2">المرادف الفصيح</th>
              <th className="resize-x overflow-hidden p-2">الحالة</th>
              <th className="resize-x overflow-hidden p-2">الظهور</th>
              <th className="resize-x overflow-hidden p-2">الاحتساب</th>
              <SortableHeader label="تاريخ الإرسال" sortKey="created_at" />
              <th className="resize-x overflow-hidden p-2">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-foreground/60 p-6 text-center">
                  لا توجد مساهمات مطابقة.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  tabIndex={0}
                  className="border-border focus-visible:bg-accent/10 border-b last:border-0"
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      router.push(`/admin/review/${row.id}`);
                  }}
                >
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleSelected(row.id)}
                      aria-label={`تحديد ${row.submitted_word}`}
                    />
                  </td>
                  <td className="p-2 font-medium">{row.submitted_word}</td>
                  <td className="p-2">{row.submitted_dialect}</td>
                  <td className="p-2">
                    <ResolvedClassificationCell
                      selected={selected.has(row.id)}
                      rowPlan={rowPlanFor(row.id)}
                      override={overrides[row.id]}
                      dialects={dialects}
                    />
                  </td>
                  <td className="p-2">{row.submitted_msa_synonym || "—"}</td>
                  <td className="p-2">
                    <StatusBadge status={row.review_status} />
                  </td>
                  <td className="p-2">
                    <VisibilityBadge link={primaryCanonicalLink(row)} />
                  </td>
                  <td className="p-2">
                    <ParticipationBadge
                      reason={row.participation_exclusion_reason}
                    />
                  </td>
                  <td className="text-foreground/70 p-2">
                    {new Date(row.created_at).toLocaleDateString("ar")}
                  </td>
                  <td className="p-2">
                    <Link
                      href={`/admin/review/${row.id}`}
                      className="text-accent font-semibold hover:underline"
                    >
                      فتح
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-center gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={page <= 1}
          onClick={() => updateParams({ page: String(page - 1) })}
        >
          السابق
        </Button>
        <span className="text-sm">
          صفحة {page} من {totalPages}
        </span>
        <Button
          type="button"
          variant="secondary"
          disabled={page >= totalPages}
          onClick={() => updateParams({ page: String(page + 1) })}
        >
          التالي
        </Button>
      </div>
    </div>
  );

  function SortableHeader({
    label,
    sortKey,
  }: {
    label: string;
    sortKey: string;
  }) {
    return (
      <th className="resize-x overflow-hidden p-2">
        <button
          type="button"
          className="font-semibold hover:underline"
          onClick={() => updateParams({ sortBy: sortKey })}
        >
          {label}
        </button>
      </th>
    );
  }
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  const toneClass: Record<ReviewStatus, string> = {
    new: "bg-accent/20 text-accent",
    pending: "bg-surface-muted text-foreground",
    approved: "bg-success/20 text-success",
    rejected: "bg-danger/20 text-danger",
    duplicate: "bg-surface-muted text-foreground",
    merged: "bg-surface-muted text-foreground",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${toneClass[status]}`}
    >
      {STATUS_LABELS_AR[status]}
    </span>
  );
}

/** Never a bare "approved/rejected" badge implying export/leaderboard status — this shows whether the row actually counts toward submission_count right now, and why not when it doesn't. */
function ParticipationBadge({
  reason,
}: {
  reason: ParticipationExclusionReason | null;
}) {
  if (!reason) {
    return (
      <span className="bg-success/20 text-success inline-block rounded-full px-2 py-0.5 text-xs font-semibold">
        يُحتسب
      </span>
    );
  }
  return (
    <span
      className="bg-danger/20 text-danger inline-block rounded-full px-2 py-0.5 text-xs font-semibold"
      title={`مستبعدة: ${EXCLUSION_REASON_LABELS[reason]}`}
    >
      لا يُحتسب ({EXCLUSION_REASON_LABELS[reason]})
    </span>
  );
}

/** Never labels an approved-private word as merely rejected/pending — always an explicit "معتمد — غير ظاهر للعامة" state, distinct from a bare "معتمد". */
function VisibilityBadge({
  link,
}: {
  link: { public_visibility: PublicVisibility } | null;
}) {
  if (!link) return <span className="text-foreground/40">—</span>;
  if (link.public_visibility === "public") {
    return (
      <span className="bg-success/20 text-success inline-block rounded-full px-2 py-0.5 text-xs font-semibold">
        منشور للعامة
      </span>
    );
  }
  return (
    <span
      className="bg-surface-muted text-foreground inline-block rounded-full px-2 py-0.5 text-xs font-semibold"
      title="معتمد — غير ظاهر للعامة"
    >
      معتمد — غير ظاهر للعامة
    </span>
  );
}

/**
 * Compact per-row automatic-classification display: "مديني ← حجازي" for a
 * resolved local dialect, a bare "نجدي" when the main group itself is the
 * classification, and a warning state only for a genuinely unresolved row
 * — never a blocking dropdown on every row (see WordCard/CLAUDE.md: the
 * override is the exception, not the default path).
 */
function ResolvedClassificationCell({
  selected,
  rowPlan,
  override,
  dialects,
}: {
  selected: boolean;
  rowPlan: {
    kind: "trusted_local" | "main_group" | "create_local" | "needs_attention";
    mainGroupCode?: MainDialectGroupCode;
    label: string;
  } | null;
  override?: string;
  dialects: { id: string; name_ar: string }[];
}) {
  if (!selected) return <span className="text-foreground/40">—</span>;
  if (!rowPlan) return <span className="text-foreground/50 text-xs">…</span>;

  if (override) {
    const overrideLabel = dialects.find((d) => d.id === override)?.name_ar;
    return (
      <span className="text-foreground text-xs font-medium">
        {overrideLabel ?? "—"} (تجاوز يدوي)
      </span>
    );
  }

  if (rowPlan.kind === "needs_attention") {
    return (
      <span className="bg-danger/10 text-danger inline-block rounded-full px-2 py-0.5 text-xs font-semibold">
        تحتاج مراجعة
      </span>
    );
  }

  const groupLabel = rowPlan.mainGroupCode
    ? MAIN_GROUP_LABELS[rowPlan.mainGroupCode]
    : "";

  if (rowPlan.kind === "main_group") {
    return (
      <span className="text-foreground text-xs font-medium">{groupLabel}</span>
    );
  }

  return (
    <span className="text-foreground text-xs font-medium">
      {rowPlan.label} ← {groupLabel}
      {rowPlan.kind === "create_local" ? " (جديدة)" : ""}
    </span>
  );
}
