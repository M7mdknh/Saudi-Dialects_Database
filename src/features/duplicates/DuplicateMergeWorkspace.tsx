"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  mergeDuplicateGroup,
  reopenDuplicateGroup,
  resolveDuplicateGroup,
  type DuplicateGroupMember,
  type DuplicateGroupRow,
} from "./actions";
import {
  CANDIDATE_TYPE_LABELS_AR,
  RESOLUTION_STATUS_LABELS_AR,
} from "./labels";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ALLOWED_REGISTERS } from "@/features/exports/projection";
import type { PublicVisibility } from "@/lib/supabase/types";

interface DialectOption {
  id: string;
  name_ar: string;
}

interface ExampleRow {
  id: string;
  sentence: string;
  sourceMemberId: string;
  sourceWord: string;
  sourceType: "raw" | "canonical";
}

const REGISTER_LABELS_AR: Record<string, string> = {
  neutral: "محايد",
  informal: "غير رسمي",
  slang: "عامي",
  offensive: "مسيء",
  taboo: "محظور",
  archaic: "قديم الاستخدام",
};

export function DuplicateMergeWorkspace({
  row,
  members,
  dialects,
}: {
  row: DuplicateGroupRow;
  members: DuplicateGroupMember[];
  dialects: DialectOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "saving" | "error" | "done">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState("");

  const canonicalMember = members.find((m) => m.memberType === "canonical");
  const rawMembers = members.filter((m) => m.memberType === "raw");

  const [targetEntryId, setTargetEntryId] = useState<string | null>(
    canonicalMember?.memberId ?? null,
  );
  const [word, setWord] = useState(
    canonicalMember?.word ?? rawMembers[0]?.word ?? row.word,
  );
  const [dialectId, setDialectId] = useState(dialects[0]?.id ?? "");
  const [explanation, setExplanation] = useState(
    canonicalMember?.meaning ?? members.find((m) => m.meaning)?.meaning ?? "",
  );
  const [msaSynonyms, setMsaSynonyms] = useState<string[]>(() => {
    const all = members.flatMap((m) => (m.msaSynonym ? [m.msaSynonym] : []));
    return [...new Set(all)];
  });
  const [newSynonym, setNewSynonym] = useState("");
  const [relatedWords, setRelatedWords] = useState<string[]>(() => [
    ...new Set(members.flatMap((m) => m.relatedWords)),
  ]);
  const [newRelatedWord, setNewRelatedWord] = useState("");
  const [conceptId, setConceptId] = useState(canonicalMember?.conceptId ?? "");
  const [register, setRegister] = useState(canonicalMember?.register ?? "");
  const [visibility, setVisibility] = useState<PublicVisibility>(
    canonicalMember?.publicVisibility ?? "public",
  );

  const allExamples: ExampleRow[] = useMemo(
    () =>
      members.flatMap((m) =>
        m.examples.map((e) => ({
          id: e.id,
          sentence: e.sentence,
          sourceMemberId: m.memberId,
          sourceWord: m.word,
          sourceType: m.memberType,
        })),
      ),
    [members],
  );

  const [selectedExampleIds, setSelectedExampleIds] = useState<Set<string>>(
    () => new Set(allExamples.map((e) => e.id)),
  );
  const [editedSentences, setEditedSentences] = useState<
    Record<string, string>
  >({});

  function toggleExample(id: string) {
    setSelectedExampleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addSynonym() {
    const v = newSynonym.trim();
    if (v && !msaSynonyms.includes(v)) setMsaSynonyms((s) => [...s, v]);
    setNewSynonym("");
  }

  function addRelatedWord() {
    const v = newRelatedWord.trim();
    if (v && v !== word && !relatedWords.includes(v))
      setRelatedWords((s) => [...s, v]);
    setNewRelatedWord("");
  }

  function handleMerge() {
    setStatus("saving");
    startTransition(async () => {
      try {
        const rawSubmissionIds = rawMembers.map((m) => m.memberId);
        const selectedExamples = allExamples
          .filter((e) => selectedExampleIds.has(e.id))
          .map((e, index) => ({
            sentence: editedSentences[e.id] ?? e.sentence,
            sourceRawExampleId: e.sourceType === "raw" ? e.id : null,
            position: index,
          }));
        // Canonical examples that were deselected must be actively removed
        // from the target entry, not just omitted (omission alone would
        // leave the old row in place since merge only inserts/updates).
        const removedCanonicalExampleIds = allExamples
          .filter(
            (e) =>
              e.sourceType === "canonical" && !selectedExampleIds.has(e.id),
          )
          .map((e) => e.id);

        const referencePromptId =
          rawMembers.find((m) => m.referencePromptId)?.referencePromptId ??
          canonicalMember?.referencePromptId ??
          null;

        const entryId = await mergeDuplicateGroup({
          groupKey: row.groupKey,
          memberSignature: row.memberSignature,
          rawSubmissionIds,
          targetEntryId,
          expectedVersion: targetEntryId
            ? (canonicalMember?.version ?? null)
            : null,
          word,
          dialectId,
          msaSynonyms,
          explanation,
          examples: selectedExamples,
          removedCanonicalExampleIds,
          relatedWords,
          conceptId: conceptId.trim() || null,
          register: register || null,
          visibility,
          referencePromptId,
        });
        setStatus("done");
        router.push(`/admin/duplicates?merged=${entryId}`);
        router.refresh();
      } catch (error) {
        setStatus("error");
        setErrorMessage(
          (error as { message?: string })?.message?.includes("stale")
            ? "تغيّر هذا الكيان من قبل مشرف آخر. أعد تحميل الصفحة وحاول مجدداً."
            : "تعذّر إتمام الدمج. حاول مرة أخرى.",
        );
      }
    });
  }

  function handleQuickResolve(newStatus: "not_duplicate" | "ignored") {
    startTransition(async () => {
      try {
        await resolveDuplicateGroup(
          row.groupKey,
          newStatus,
          row.memberSignature,
        );
        router.push("/admin/duplicates");
        router.refresh();
      } catch {
        setStatus("error");
        setErrorMessage("تعذّر تحديث حالة المجموعة.");
      }
    });
  }

  function handleReopen() {
    startTransition(async () => {
      try {
        await reopenDuplicateGroup(row.groupKey);
        router.refresh();
      } catch {
        setStatus("error");
        setErrorMessage("تعذّر إعادة فتح المجموعة.");
      }
    });
  }

  const previewExamples = allExamples
    .filter((e) => selectedExampleIds.has(e.id))
    .map((e) => editedSentences[e.id] ?? e.sentence);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">مساحة الدمج</h1>
        <span className="bg-surface-muted rounded-full px-2 py-0.5 text-xs font-semibold">
          {CANDIDATE_TYPE_LABELS_AR[row.candidateType]}
        </span>
      </div>

      {row.resolutionStatus !== "unresolved" ? (
        <div className="border-border bg-surface-muted flex items-center justify-between rounded-xl border p-3 text-sm">
          <span>
            حالة هذه المجموعة حالياً:{" "}
            {RESOLUTION_STATUS_LABELS_AR[row.resolutionStatus]}
          </span>
          {row.resolutionStatus !== "merged" ? (
            <Button
              type="button"
              variant="ghost"
              onClick={handleReopen}
              disabled={pending}
            >
              إعادة الفتح
            </Button>
          ) : null}
        </div>
      ) : null}

      <section className="border-border bg-surface rounded-2xl border p-4">
        <h2 className="text-foreground/70 mb-3 text-sm font-bold">المصادر</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {members.map((m) => (
            <div
              key={m.memberId}
              className={`rounded-xl border p-3 ${
                targetEntryId === m.memberId
                  ? "border-accent bg-accent/5"
                  : "border-border"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold">{m.word}</span>
                {m.memberType === "canonical" ? (
                  <span className="bg-surface-muted rounded-full px-2 py-0.5 text-xs">
                    كيان معتمد حالياً
                  </span>
                ) : (
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="radio"
                      name="target-entry"
                      checked={
                        targetEntryId === null &&
                        rawMembers[0]?.memberId === m.memberId
                      }
                      onChange={() => setTargetEntryId(null)}
                    />
                    اجعلها الأساس
                  </label>
                )}
              </div>
              <p className="text-foreground/70 text-sm">
                اللهجة: {m.mainGroupCode ?? "—"}{" "}
                {m.localDialectLabel ? `(${m.localDialectLabel})` : ""}
              </p>
              <p className="text-foreground/70 text-sm">
                المرادف: {m.msaSynonym || "—"}
              </p>
              {m.meaning ? (
                <p className="text-foreground/70 text-sm">{m.meaning}</p>
              ) : null}
            </div>
          ))}
        </div>
        {canonicalMember ? (
          <div className="mt-3 flex gap-4 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="target-entry"
                checked={targetEntryId === canonicalMember.memberId}
                onChange={() => setTargetEntryId(canonicalMember.memberId)}
              />
              الدمج داخل الكيان المعتمد الحالي
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="target-entry"
                checked={targetEntryId === null}
                onChange={() => setTargetEntryId(null)}
              />
              إنشاء كيان معتمد جديد
            </label>
          </div>
        ) : null}
      </section>

      <section className="border-border bg-surface rounded-2xl border p-4">
        <h2 className="text-foreground/70 mb-3 text-sm font-bold">
          القيم الكنسية النهائية
        </h2>
        <div className="flex flex-col gap-3">
          <Field id="dup-merge-word" label="الكلمة المعتمدة">
            <input
              id="dup-merge-word"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            />
          </Field>
          <Field id="dup-merge-dialect" label="اللهجة المحلية المعتمدة">
            <select
              id="dup-merge-dialect"
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
          <Field id="dup-merge-explanation" label="المعنى المعتمد">
            <textarea
              id="dup-merge-explanation"
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              rows={3}
              className="border-border bg-surface w-full rounded-lg border px-3 py-2"
            />
          </Field>

          <div>
            <p className="mb-1 text-sm font-semibold">المرادفات الفصيحة</p>
            <ul className="mb-2 flex flex-wrap gap-2">
              {msaSynonyms.map((s) => (
                <li
                  key={s}
                  className="bg-surface-muted flex items-center gap-1 rounded-full px-2 py-1 text-sm"
                >
                  {s}
                  <button
                    type="button"
                    aria-label={`إزالة ${s}`}
                    onClick={() =>
                      setMsaSynonyms((prev) => prev.filter((x) => x !== s))
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                value={newSynonym}
                onChange={(e) => setNewSynonym(e.target.value)}
                className="border-border bg-surface min-h-11 flex-1 rounded-lg border px-3 py-2"
                placeholder="إضافة مرادف"
              />
              <Button type="button" variant="secondary" onClick={addSynonym}>
                إضافة
              </Button>
            </div>
          </div>

          <div>
            <p className="mb-1 text-sm font-semibold">كلمات ذات صلة</p>
            <ul className="mb-2 flex flex-wrap gap-2">
              {relatedWords.map((w) => (
                <li
                  key={w}
                  className="bg-surface-muted flex items-center gap-1 rounded-full px-2 py-1 text-sm"
                >
                  {w}
                  <button
                    type="button"
                    aria-label={`إزالة ${w}`}
                    onClick={() =>
                      setRelatedWords((prev) => prev.filter((x) => x !== w))
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                value={newRelatedWord}
                onChange={(e) => setNewRelatedWord(e.target.value)}
                className="border-border bg-surface min-h-11 flex-1 rounded-lg border px-3 py-2"
                placeholder="إضافة كلمة ذات صلة"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={addRelatedWord}
              >
                إضافة
              </Button>
            </div>
          </div>

          <Field id="dup-merge-concept" label="معرّف المفهوم (اختياري)">
            <input
              id="dup-merge-concept"
              value={conceptId}
              onChange={(e) => setConceptId(e.target.value)}
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
              dir="ltr"
            />
          </Field>

          <Field id="dup-merge-register" label="السجل اللغوي (اختياري)">
            <select
              id="dup-merge-register"
              value={register}
              onChange={(e) => setRegister(e.target.value)}
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            >
              <option value="">بدون تحديد</option>
              {ALLOWED_REGISTERS.map((r) => (
                <option key={r} value={r}>
                  {REGISTER_LABELS_AR[r]}
                </option>
              ))}
            </select>
          </Field>

          <Field id="dup-merge-visibility" label="ظهور الكلمة">
            <select
              id="dup-merge-visibility"
              value={visibility}
              onChange={(e) =>
                setVisibility(e.target.value as PublicVisibility)
              }
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            >
              <option value="public">عام</option>
              <option value="private">خاص</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="border-border bg-surface rounded-2xl border p-4">
        <h2 className="text-foreground/70 mb-3 text-sm font-bold">
          اختر الأمثلة من كل مصدر (يمكن تعديلها)
        </h2>
        <ul className="flex flex-col gap-2">
          {allExamples.map((e) => (
            <li key={e.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                id={`dup-ex-${e.id}`}
                checked={selectedExampleIds.has(e.id)}
                onChange={() => toggleExample(e.id)}
                className="mt-2"
              />
              <div className="flex-1">
                <input
                  value={editedSentences[e.id] ?? e.sentence}
                  onChange={(ev) =>
                    setEditedSentences((prev) => ({
                      ...prev,
                      [e.id]: ev.target.value,
                    }))
                  }
                  disabled={!selectedExampleIds.has(e.id)}
                  className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2 disabled:opacity-50"
                />
                <span className="text-foreground/50 text-xs">
                  من: {e.sourceWord}
                  {e.sourceType === "canonical" ? " (كيان معتمد)" : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-border bg-surface rounded-2xl border p-4">
        <h2 className="text-foreground/70 mb-3 text-sm font-bold">
          معاينة السجل النهائي
        </h2>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-foreground/60">الكلمة</dt>
            <dd className="font-semibold">{word}</dd>
          </div>
          <div>
            <dt className="text-foreground/60">المعنى</dt>
            <dd>{explanation || "—"}</dd>
          </div>
          <div>
            <dt className="text-foreground/60">المرادفات</dt>
            <dd>{msaSynonyms.join("، ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-foreground/60">كلمات ذات صلة</dt>
            <dd>{relatedWords.join("، ") || "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-foreground/60">
              الأمثلة ({previewExamples.length})
            </dt>
            <dd>
              <ul className="list-disc pr-4">
                {previewExamples.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
      </section>

      {status === "error" ? (
        <p role="alert" className="text-danger text-sm">
          {errorMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending || previewExamples.length === 0}
          onClick={handleMerge}
        >
          {pending && status === "saving" ? "جارٍ الدمج…" : "دمج وحفظ"}
        </Button>
        {row.resolutionStatus === "unresolved" ? (
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => handleQuickResolve("not_duplicate")}
            >
              ليست مكررة
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => handleQuickResolve("ignored")}
            >
              تجاهل حالياً
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
