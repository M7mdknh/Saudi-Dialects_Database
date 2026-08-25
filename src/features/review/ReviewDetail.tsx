"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import {
  approveSubmission,
  setCanonicalVisibility,
  setParticipationExclusion,
  setReviewStatus,
  setSubmissionMainGroup,
  undoReviewEvent,
} from "./actions";
import {
  approvedVisibilityBadgeLabel,
  STATUS_LABELS_AR,
} from "./status-labels";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
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

interface ExampleRow {
  id: string;
  sentence: string;
}

interface SubmissionDetail {
  id: string;
  submitted_word: string;
  submitted_dialect: string;
  submitted_msa_synonym: string | null;
  submitted_explanation: string | null;
  review_status: ReviewStatus;
  created_at: string;
  updated_at: string;
  raw_examples: ExampleRow[];
  reference_prompt_id: string | null;
  reference_prompt_snapshot: unknown;
  participation_exclusion_reason: ParticipationExclusionReason | null;
  selected_dialect_id: string | null;
  provisional_main_group_code: MainDialectGroupCode | null;
  admin_confirmed_main_group_code: MainDialectGroupCode | null;
}

interface ReferencePromptSnapshotView {
  msaLemma: string;
  definitionAr: string;
  scenarioAr: string;
  categoryLabelAr: string;
}

function readSnapshot(value: unknown): ReferencePromptSnapshotView | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.msaLemma !== "string" ||
    typeof v.definitionAr !== "string" ||
    typeof v.scenarioAr !== "string" ||
    typeof v.categoryLabelAr !== "string"
  ) {
    return null;
  }
  return {
    msaLemma: v.msaLemma,
    definitionAr: v.definitionAr,
    scenarioAr: v.scenarioAr,
    categoryLabelAr: v.categoryLabelAr,
  };
}

interface ReviewEventRow {
  id: string;
  action: string;
  before_state: unknown;
  after_state: unknown;
  created_at: string;
}

interface DuplicateCandidate {
  id: string;
  submitted_word: string;
  submitted_dialect: string;
  review_status: ReviewStatus;
  same_dialect: boolean;
}

interface DialectOption {
  id: string;
  name_ar: string;
}

interface CanonicalLinkStatus {
  entryId: string;
  editorialStatus: string;
  exampleCount: number;
  publicVisibility: PublicVisibility;
  version: number;
}

interface ReviewDetailProps {
  submission: SubmissionDetail;
  history: ReviewEventRow[];
  duplicates: DuplicateCandidate[];
  dialects: DialectOption[];
  canonicalStatus: CanonicalLinkStatus | null;
}

export function ReviewDetail({
  submission,
  history,
  duplicates,
  dialects,
  canonicalStatus,
}: ReviewDetailProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "error" | "stale"
  >("idle");
  const [canonicalWord, setCanonicalWord] = useState(submission.submitted_word);
  const [dialectId, setDialectId] = useState(dialects[0]?.id ?? "");
  const [msaSynonym, setMsaSynonym] = useState(
    submission.submitted_msa_synonym ?? "",
  );
  const [explanation, setExplanation] = useState(
    submission.submitted_explanation ?? "",
  );

  function act(newStatus: Exclude<ReviewStatus, "approved">) {
    startTransition(async () => {
      setStatus("saving");
      const result = await setReviewStatus(
        submission.id,
        newStatus,
        submission.updated_at,
      );
      if (result.stale) {
        setStatus("stale");
        return;
      }
      setStatus("saved");
      router.refresh();
    });
  }

  function approveWithCanonicalEdit(visibility: PublicVisibility) {
    if (!dialectId) {
      setStatus("error");
      return;
    }
    startTransition(async () => {
      setStatus("saving");
      try {
        const result = await approveSubmission({
          submissionId: submission.id,
          dialectId,
          expectedUpdatedAt: submission.updated_at,
          canonicalEdit: {
            word: canonicalWord,
            msaSynonyms: msaSynonym.trim() ? [msaSynonym.trim()] : [],
            explanation,
          },
          visibility,
        });
        if (result.stale) {
          setStatus("stale");
          return;
        }
        setStatus("saved");
        router.refresh();
      } catch {
        setStatus("error");
      }
    });
  }

  function toggleVisibility(next: PublicVisibility) {
    if (!canonicalStatus) return;
    startTransition(async () => {
      setStatus("saving");
      try {
        const result = await setCanonicalVisibility(
          canonicalStatus.entryId,
          next,
          canonicalStatus.version,
        );
        if (result.stale) {
          setStatus("stale");
          return;
        }
        setStatus("saved");
        router.refresh();
      } catch {
        setStatus("error");
      }
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{submission.submitted_word}</h1>
        <span className="text-foreground/60 text-sm">
          {STATUS_LABELS_AR[submission.review_status]}
        </span>
      </div>

      <ExportEligibilityBanner
        reviewStatus={submission.review_status}
        canonicalStatus={canonicalStatus}
      />

      <ParticipationSection
        submission={submission}
        onChanged={router.refresh}
      />

      {(() => {
        const snapshot = readSnapshot(submission.reference_prompt_snapshot);
        if (!snapshot) return null;
        return (
          <div className="border-accent/30 bg-accent/5 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm">
            <span className="bg-accent/10 text-accent mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold">
              معنى مقترح
            </span>
            <span className="text-foreground/80">
              {snapshot.categoryLabelAr} — {snapshot.msaLemma}:{" "}
              {snapshot.definitionAr}
            </span>
          </div>
        );
      })()}

      <section className="border-border bg-surface rounded-2xl border p-4">
        <h2 className="text-foreground/70 mb-3 text-sm font-bold">
          القيم كما أدخلها المساهم
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-foreground/60 text-xs">الكلمة</dt>
            <dd>{submission.submitted_word}</dd>
          </div>
          <div>
            <dt className="text-foreground/60 text-xs">اللهجة أو المنطقة</dt>
            <dd>{submission.submitted_dialect}</dd>
          </div>
          <div>
            <dt className="text-foreground/60 text-xs">المرادف الفصيح</dt>
            <dd>{submission.submitted_msa_synonym || "—"}</dd>
          </div>
          <div>
            <dt className="text-foreground/60 text-xs">المعنى</dt>
            <dd>{submission.submitted_explanation || "—"}</dd>
          </div>
        </dl>
        <div className="mt-3">
          <dt className="text-foreground/60 text-xs">الأمثلة</dt>
          <ul className="list-disc pr-5">
            {submission.raw_examples.map((ex) => (
              <li key={ex.id}>{ex.sentence}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-border bg-surface rounded-2xl border p-4">
        <h2 className="text-foreground/70 mb-3 text-sm font-bold">
          تحرير الحقول الكنسية والاعتماد
        </h2>
        <div className="flex flex-col gap-3">
          <Field id="canonical-word" label="الكلمة المعتمدة">
            <input
              id="canonical-word"
              value={canonicalWord}
              onChange={(e) => setCanonicalWord(e.target.value)}
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            />
          </Field>
          <Field id="canonical-dialect" label="اللهجة المعتمدة">
            <select
              id="canonical-dialect"
              value={dialectId}
              onChange={(e) => setDialectId(e.target.value)}
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            >
              {dialects.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name_ar}
                </option>
              ))}
            </select>
          </Field>
          <Field id="canonical-msa" label="المرادف الفصيح المعتمد">
            <input
              id="canonical-msa"
              value={msaSynonym}
              onChange={(e) => setMsaSynonym(e.target.value)}
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            />
          </Field>
          <Field id="canonical-explanation" label="الشرح المعتمد">
            <textarea
              id="canonical-explanation"
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              rows={3}
              className="border-border bg-surface w-full rounded-lg border px-3 py-2"
            />
          </Field>
        </div>

        {status === "stale" ? (
          <p
            role="alert"
            className="border-danger bg-danger/10 text-danger mt-3 rounded-lg border px-3 py-2 text-sm"
          >
            تغيّر هذا السجل من قبل مشرف آخر. أعد تحميل الصفحة قبل المتابعة.
          </p>
        ) : null}
        {status === "saved" ? (
          <p role="status" className="text-success mt-3 text-sm">
            تم الحفظ.
          </p>
        ) : null}
        {status === "error" ? (
          <p role="alert" className="text-danger mt-3 text-sm">
            حدث خطأ أثناء الحفظ.
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={pending}
            onClick={() => approveWithCanonicalEdit("public")}
          >
            اعتماد ونشر
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => approveWithCanonicalEdit("private")}
            title="يبقى معتمدًا وقابلاً للتصدير، لكن لا يظهر في أي صفحة عامة"
          >
            اعتماد بدون نشر
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={pending}
            onClick={() => act("rejected")}
          >
            رفض
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => act("duplicate")}
          >
            تمييز كمكرر
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => act("pending")}
          >
            إعادة لقيد المراجعة
          </Button>
        </div>

        {canonicalStatus?.editorialStatus === "approved" ? (
          <div className="border-border mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
            <span className="text-foreground/70 text-sm">
              {approvedVisibilityBadgeLabel(canonicalStatus.publicVisibility)}
            </span>
            {canonicalStatus.publicVisibility === "private" ? (
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => toggleVisibility("public")}
              >
                إظهار للعامة
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => toggleVisibility("private")}
              >
                إخفاء عن العامة
              </Button>
            )}
          </div>
        ) : null}
      </section>

      {duplicates.length > 0 ? (
        <section className="border-border bg-surface rounded-2xl border p-4">
          <h2 className="text-foreground/70 mb-3 text-sm font-bold">
            مرشحون محتملون للتكرار
          </h2>
          <ul className="flex flex-col gap-2">
            {duplicates.map((d) => (
              <li
                key={d.id}
                className="bg-surface-muted flex items-center justify-between rounded-lg px-3 py-2 text-sm"
              >
                <span>
                  {d.submitted_word} — {d.submitted_dialect} (
                  {STATUS_LABELS_AR[d.review_status]})
                </span>
                <Link
                  href={`/admin/merge?ids=${submission.id},${d.id}`}
                  className="text-accent font-semibold hover:underline"
                >
                  دمج
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="border-border bg-surface rounded-2xl border p-4">
        <h2 className="text-foreground/70 mb-3 text-sm font-bold">
          سجل المراجعة
        </h2>
        {history.length === 0 ? (
          <p className="text-foreground/60 text-sm">لا توجد إجراءات سابقة.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((event) => (
              <li
                key={event.id}
                className="flex items-center justify-between text-sm"
              >
                <span>
                  {event.action} —{" "}
                  {new Date(event.created_at).toLocaleString("ar")}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-8 px-2 text-xs"
                  onClick={() =>
                    startTransition(async () => {
                      await undoReviewEvent(event.id);
                      router.refresh();
                    })
                  }
                >
                  تراجع
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Makes the distinction the review workflow can otherwise hide: a raw
 * submission's own `review_status` says nothing about whether an actual
 * exportable canonical record exists. Never show a bare "معتمد" without
 * this context — that ambiguity is exactly what produced the empty-export
 * bug (see migration 0017).
 */
function ExportEligibilityBanner({
  reviewStatus,
  canonicalStatus,
}: {
  reviewStatus: ReviewStatus;
  canonicalStatus: CanonicalLinkStatus | null;
}) {
  if (reviewStatus === "rejected" || reviewStatus === "duplicate") return null;

  if (reviewStatus === "approved") {
    if (canonicalStatus?.editorialStatus === "approved") {
      const isPrivate = canonicalStatus.publicVisibility === "private";
      return (
        <p
          className={`rounded-lg border px-3 py-2 text-sm font-medium ${
            isPrivate
              ? "border-border bg-surface-muted text-foreground/80"
              : "border-success/30 bg-success/5 text-success"
          }`}
        >
          {isPrivate
            ? "معتمدة وجاهزة للتصدير، لكنها غير ظاهرة للعامة"
            : "معتمدة وجاهزة للتصدير ومنشورة للعامة"}
          {canonicalStatus.exampleCount === 0
            ? " (تنبيه: بلا أمثلة معتمدة بعد)"
            : ""}
          .
        </p>
      );
    }
    // Legacy state from before migration 0017: review_status flipped to
    // "approved" without ever promoting a canonical entry. Clicking
    // "اعتماد" again now runs the complete transaction and fixes it.
    return (
      <p className="border-danger/30 bg-danger/5 text-danger rounded-lg border px-3 py-2 text-sm font-medium">
        معتمدة كإدخال، لكن لا يوجد سجل كنسي مكتمل — لن تظهر في التصدير. اضغط
        «اعتماد» أدناه لإكمالها.
      </p>
    );
  }

  if (canonicalStatus?.editorialStatus === "draft") {
    return (
      <p className="border-border bg-surface-muted text-foreground/70 rounded-lg border px-3 py-2 text-sm">
        مصنّفة بلهجة معتمدة (مسودة) لكن لم تُعتمد بعد — لن تظهر في التصدير حتى
        الاعتماد.
      </p>
    );
  }

  return null;
}

/**
 * Participation (leaderboard) state is independent of review_status —
 * this submission already counted toward submission_count the instant it
 * was received (see migration 0019), and stays counted through pending,
 * approved, or an ordinary rejection. Only an explicit exclusion reason
 * (spam/abuse/test/duplicate/invalid_submission) removes it.
 */
function ParticipationSection({
  submission,
  onChanged,
}: {
  submission: SubmissionDetail;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState<ParticipationExclusionReason | "">("");
  const [mainGroup, setMainGroup] = useState<MainDialectGroupCode | "">(
    submission.admin_confirmed_main_group_code ?? "",
  );

  const isExcluded = Boolean(submission.participation_exclusion_reason);

  function applyExclusion() {
    if (!reason) return;
    startTransition(async () => {
      await setParticipationExclusion(submission.id, reason);
      onChanged();
    });
  }

  function clearExclusion() {
    startTransition(async () => {
      await setParticipationExclusion(submission.id, null);
      onChanged();
    });
  }

  function applyMainGroup() {
    if (!mainGroup) return;
    startTransition(async () => {
      await setSubmissionMainGroup(submission.id, mainGroup);
      onChanged();
    });
  }

  return (
    <section className="border-border bg-surface rounded-2xl border p-4">
      <h2 className="text-foreground/70 mb-3 text-sm font-bold">
        المشاركة في لوحة الصدارة
      </h2>
      <p className="mb-3 text-sm">
        تُحتسب كمساهمة:{" "}
        <span
          className={`font-semibold ${isExcluded ? "text-danger" : "text-success"}`}
        >
          {isExcluded
            ? `لا (${EXCLUSION_REASON_LABELS[submission.participation_exclusion_reason!]})`
            : "نعم"}
        </span>
      </p>
      <p className="text-foreground/60 mb-3 text-xs">
        المجموعة المُعتمدة إداريًا:{" "}
        {submission.admin_confirmed_main_group_code
          ? MAIN_GROUP_LABELS[submission.admin_confirmed_main_group_code]
          : "—"}{" "}
        · المجموعة التي اختارها المساهم:{" "}
        {submission.provisional_main_group_code
          ? MAIN_GROUP_LABELS[submission.provisional_main_group_code]
          : "—"}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={mainGroup}
          onChange={(e) =>
            setMainGroup(e.target.value as MainDialectGroupCode | "")
          }
          className="border-border bg-surface min-h-9 rounded-lg border px-2 text-sm"
          aria-label="نقل احتساب المشاركة إلى مجموعة رئيسية أخرى"
        >
          <option value="">اختر مجموعة المشاركة</option>
          {Object.entries(MAIN_GROUP_LABELS).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="secondary"
          disabled={pending || !mainGroup}
          onClick={applyMainGroup}
        >
          نقل الاحتساب
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={reason}
          onChange={(e) =>
            setReason(e.target.value as ParticipationExclusionReason | "")
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
          disabled={pending || !reason}
          onClick={applyExclusion}
        >
          استبعاد من الاحتساب
        </Button>
        {isExcluded ? (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={clearExclusion}
          >
            إلغاء الاستبعاد
          </Button>
        ) : null}
      </div>
    </section>
  );
}
