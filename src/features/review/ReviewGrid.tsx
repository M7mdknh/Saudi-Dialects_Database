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
  classifySubmissions,
  previewBulkApproval,
} from "./actions";
import { formatBulkApprovalResultMessage } from "./bulk-approve";
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

const NEEDS_ATTENTION_REASON_LABELS: Record<string, string> = {
  empty_label: "لا توجد لهجة مُدخلة",
  group_conflict: "اللهجة المُدخلة تتبع مجموعة رئيسية أخرى",
  ambiguous: "اللهجة المُدخلة تطابق أكثر من لهجة محلية",
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
  const [bulkDialect, setBulkDialect] = useState("");
  const [bulkMainGroup, setBulkMainGroup] = useState<MainDialectGroupCode | "">(
    "",
  );
  const [fastApproveGroup, setFastApproveGroup] = useState<
    MainDialectGroupCode | ""
  >("");
  const [plan, setPlan] = useState<Awaited<
    ReturnType<typeof previewBulkApproval>
  > | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

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
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)),
    );
  }

  function runBulk(action: () => Promise<unknown>, successMessage: string) {
    startTransition(async () => {
      try {
        await action();
        setMessage(successMessage);
        setSelected(new Set());
        setPlan(null);
        setOverrides({});
        setFastApproveGroup("");
        router.refresh();
      } catch {
        setMessage("تعذّر تنفيذ الإجراء. حاول مرة أخرى.");
      }
    });
  }

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  // Recompute the fast-approval preview (reuse/create/needs-attention
  // breakdown) whenever the selection or the chosen main group changes, so
  // the admin sees exactly what will happen before committing.
  useEffect(() => {
    if (selectedIds.length === 0 || !fastApproveGroup) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    previewBulkApproval(selectedIds, fastApproveGroup).then((result) => {
      if (!cancelled) setPlan(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.join(","), fastApproveGroup]);

  const planSummary = useMemo(() => {
    if (!plan) return null;
    let reusing = 0;
    let creating = 0;
    let mainGroupOnly = 0;
    let needsAttention = 0;
    for (const rowPlan of plan.rowPlans) {
      const overridden = Boolean(overrides[rowPlan.submissionId]);
      if (overridden) continue;
      if (rowPlan.kind === "reuse") reusing += 1;
      else if (rowPlan.kind === "create") creating += 1;
      else if (rowPlan.kind === "main_group") mainGroupOnly += 1;
      else needsAttention += 1;
    }
    return {
      total: plan.rowPlans.length,
      reusing,
      creating,
      mainGroupOnly,
      needsAttention: needsAttention,
      overridden: Object.keys(overrides).length,
    };
  }, [plan, overrides]);

  function runFastApproval(publish: boolean) {
    if (!fastApproveGroup) return;
    const large = selectedIds.length >= 20;
    const creatingNew = (planSummary?.creating ?? 0) > 0;
    if (
      (large || creatingNew) &&
      !confirm(
        creatingNew
          ? `سيتم إنشاء لهجات محلية جديدة ضمن «${MAIN_GROUP_LABELS[fastApproveGroup]}». المتابعة؟`
          : `اعتماد ${selectedIds.length} كلمة؟`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        const outcome = await bulkApproveWithSubmittedDialects(
          selectedIds,
          fastApproveGroup,
          publish ? "public" : "private",
          overrides,
        );
        setMessage(
          formatBulkApprovalResultMessage({
            approvedCount: outcome.approvedCount,
            needsAttentionCount: outcome.needsAttentionCount,
          }),
        );
        setSelected(new Set());
        setPlan(null);
        setOverrides({});
        setFastApproveGroup("");
        router.refresh();
      } catch {
        setMessage("تعذّر تنفيذ الاعتماد. حاول مرة أخرى.");
      }
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

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={fastApproveGroup}
              onChange={(e) => {
                setFastApproveGroup(
                  e.target.value as MainDialectGroupCode | "",
                );
                setOverrides({});
              }}
              className="border-border bg-surface min-h-9 rounded-lg border px-2 text-sm"
              aria-label="المجموعة الرئيسية للاعتماد السريع"
            >
              <option value="">اختر المجموعة الرئيسية للاعتماد</option>
              {Object.entries(MAIN_GROUP_LABELS).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              disabled={pending || !fastApproveGroup}
              onClick={() => runFastApproval(true)}
            >
              اعتماد ونشر باستخدام اللهجات المدخلة
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending || !fastApproveGroup}
              onClick={() => runFastApproval(false)}
            >
              اعتماد بدون نشر باستخدام اللهجات المدخلة
            </Button>
          </div>

          {planSummary ? (
            <div
              role="status"
              className="border-border bg-surface flex flex-col gap-2 rounded-lg border p-3 text-sm"
            >
              <p>
                المحدد: {planSummary.total} — يعيد استخدام لهجة موجودة:{" "}
                {planSummary.reusing} — ينشئ لهجة محلية جديدة:{" "}
                {planSummary.creating} — بالمجموعة الرئيسية فقط:{" "}
                {planSummary.mainGroupOnly}
                {planSummary.overridden > 0
                  ? ` — تم تجاوزها يدويًا: ${planSummary.overridden}`
                  : ""}
                {planSummary.needsAttention > 0
                  ? ` — تحتاج مراجعة: ${planSummary.needsAttention}`
                  : ""}
              </p>
              {plan
                ? plan.rowPlans
                    .filter(
                      (r) =>
                        r.kind === "needs_attention" &&
                        !overrides[r.submissionId],
                    )
                    .map((r) => (
                      <div
                        key={r.submissionId}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <span className="text-danger">
                          «{r.label}» —{" "}
                          {r.kind === "needs_attention"
                            ? NEEDS_ATTENTION_REASON_LABELS[r.reason]
                            : ""}
                        </span>
                        <select
                          className="border-border bg-surface min-h-8 rounded-lg border px-2 text-xs"
                          aria-label={`تجاوز اللهجة لـ ${r.label}`}
                          defaultValue=""
                          onChange={(e) => {
                            if (!e.target.value) return;
                            setOverrides((prev) => ({
                              ...prev,
                              [r.submissionId]: e.target.value,
                            }));
                          }}
                        >
                          <option value="" disabled>
                            اختر لهجة يدويًا
                          </option>
                          {dialects.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name_ar}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))
                : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={bulkDialect}
              onChange={(e) => setBulkDialect(e.target.value)}
              className="border-border bg-surface min-h-9 rounded-lg border px-2 text-sm"
              aria-label="اللهجة للتصنيف فقط"
            >
              <option value="">اختر اللهجة للتصنيف فقط</option>
              {dialects.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name_ar}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary"
              disabled={pending || !bulkDialect}
              onClick={() =>
                runBulk(
                  () => classifySubmissions(selectedIds, bulkDialect),
                  "تم التصنيف (مسودة، غير معتمد بعد).",
                )
              }
              title="يستخدم اللهجة المختارة — تصنيف بلا اعتماد"
            >
              تطبيق التصنيف فقط
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
        <p role="status" className="text-foreground/70 text-sm">
          {message}
        </p>
      ) : null}

      <div
        className="border-border overflow-x-auto rounded-xl border"
        dir="rtl"
      >
        <table className="w-full min-w-[720px] border-collapse text-sm">
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
                <td colSpan={9} className="text-foreground/60 p-6 text-center">
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
