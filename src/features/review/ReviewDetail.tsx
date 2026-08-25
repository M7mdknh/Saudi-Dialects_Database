"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import {
  setReviewStatus,
  undoReviewEvent,
  upsertCanonicalEntry,
} from "./actions";
import { STATUS_LABELS_AR } from "./status-labels";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import type { ReviewStatus } from "@/lib/supabase/types";

interface ExampleRow {
  id: string;
  sentence: string;
}

interface SubmissionDetail {
  id: string;
  submitted_word: string;
  submitted_dialect: string;
  submitted_msa_synonym: string;
  submitted_explanation: string | null;
  review_status: ReviewStatus;
  created_at: string;
  updated_at: string;
  raw_examples: ExampleRow[];
  reference_prompt_id: string | null;
  reference_prompt_snapshot: unknown;
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

interface ReviewDetailProps {
  submission: SubmissionDetail;
  history: ReviewEventRow[];
  duplicates: DuplicateCandidate[];
  dialects: DialectOption[];
}

export function ReviewDetail({
  submission,
  history,
  duplicates,
  dialects,
}: ReviewDetailProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "error" | "stale"
  >("idle");
  const [canonicalWord, setCanonicalWord] = useState(submission.submitted_word);
  const [dialectId, setDialectId] = useState(dialects[0]?.id ?? "");
  const [msaSynonym, setMsaSynonym] = useState(
    submission.submitted_msa_synonym,
  );
  const [explanation, setExplanation] = useState(
    submission.submitted_explanation ?? "",
  );

  function act(newStatus: ReviewStatus) {
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

  function approveWithCanonicalEdit() {
    startTransition(async () => {
      setStatus("saving");
      try {
        await upsertCanonicalEntry({
          entryId: null,
          expectedVersion: null,
          word: canonicalWord,
          dialectId,
          msaSynonyms: [msaSynonym],
          explanation,
          editorialStatus: "approved",
          referencePromptId: submission.reference_prompt_id,
        });
        await setReviewStatus(submission.id, "approved", submission.updated_at);
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
            <dd>{submission.submitted_msa_synonym}</dd>
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
            onClick={approveWithCanonicalEdit}
          >
            اعتماد
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
