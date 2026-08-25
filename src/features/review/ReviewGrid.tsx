"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { STATUS_LABELS_AR, REVIEW_STATUS_FILTERS } from "./status-labels";
import {
  bulkApproveSubmissions,
  bulkSetParticipationExclusion,
  bulkSetReviewStatus,
  bulkSetSubmissionMainGroup,
  classifySubmissions,
} from "./actions";
import { Button } from "@/components/ui/Button";
import type {
  MainDialectGroupCode,
  ParticipationExclusionReason,
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

interface ExampleRow {
  id: string;
  sentence: string;
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
  search?: string;
  dialects: DialectOption[];
}

export function ReviewGrid({
  rows,
  total,
  page,
  pageSize,
  status,
  search,
  dialects,
}: ReviewGridProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [bulkDialect, setBulkDialect] = useState("");
  const [exclusionReason, setExclusionReason] = useState<
    ParticipationExclusionReason | ""
  >("");
  const [bulkMainGroup, setBulkMainGroup] = useState<MainDialectGroupCode | "">(
    "",
  );
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
        router.refresh();
      } catch {
        setMessage("تعذّر تنفيذ الإجراء. حاول مرة أخرى.");
      }
    });
  }

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

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
          value={status ?? ""}
          onChange={(e) =>
            updateParams({
              status: e.target.value || undefined,
              page: undefined,
            })
          }
          className="border-border bg-surface min-h-11 rounded-lg border px-3 py-2"
          aria-label="تصفية حسب الحالة"
        >
          <option value="">كل الحالات</option>
          {REVIEW_STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS_AR[s]}
            </option>
          ))}
        </select>
      </div>

      {selectedIds.length > 0 ? (
        <div className="border-accent bg-accent/10 flex flex-wrap items-center gap-2 rounded-xl border p-3">
          <span className="text-sm font-medium">
            تم تحديد {selectedIds.length} سجل
          </span>
          <select
            value={bulkDialect}
            onChange={(e) => setBulkDialect(e.target.value)}
            className="border-border bg-surface min-h-9 rounded-lg border px-2 text-sm"
            aria-label="اللهجة المعتمدة (مطلوبة للاعتماد أو التصنيف)"
          >
            <option value="">اختر اللهجة المعتمدة</option>
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
            title={
              bulkDialect
                ? undefined
                : "اختر اللهجة المعتمدة أولاً — الاعتماد يتطلب تصنيفًا"
            }
            onClick={() => {
              if (!confirm(`اعتماد ${selectedIds.length} سجل؟`)) return;
              runBulk(
                () => bulkApproveSubmissions(selectedIds, bulkDialect),
                "تم الاعتماد. الكلمات الآن جاهزة للتصدير.",
              );
            }}
          >
            اعتماد
          </Button>
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
              <th className="resize-x overflow-hidden p-2">الاحتساب</th>
              <SortableHeader label="تاريخ الإرسال" sortKey="created_at" />
              <th className="resize-x overflow-hidden p-2">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-foreground/60 p-6 text-center">
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
