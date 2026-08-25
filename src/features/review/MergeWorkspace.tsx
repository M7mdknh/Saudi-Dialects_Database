"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { mergeSubmissions } from "./actions";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

interface ExampleRow {
  id: string;
  sentence: string;
}

interface SubmissionRow {
  id: string;
  submitted_word: string;
  submitted_dialect: string;
  submitted_msa_synonym: string;
  submitted_explanation: string | null;
  raw_examples: ExampleRow[];
  reference_prompt_id: string | null;
}

interface DialectOption {
  id: string;
  name_ar: string;
}

export function MergeWorkspace({
  submissions,
  dialects,
}: {
  submissions: SubmissionRow[];
  dialects: DialectOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [word, setWord] = useState(submissions[0].submitted_word);
  const [dialectId, setDialectId] = useState(dialects[0]?.id ?? "");
  const [msaSynonym, setMsaSynonym] = useState(
    submissions[0].submitted_msa_synonym,
  );
  const [explanation, setExplanation] = useState(
    submissions[0].submitted_explanation ?? "",
  );
  const [selectedExamples, setSelectedExamples] = useState<Set<string>>(
    () => new Set(submissions[0].raw_examples.map((e) => e.id)),
  );
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  const allExamples = submissions.flatMap((s) =>
    s.raw_examples.map((e) => ({ ...e, source: s })),
  );

  function toggleExample(id: string) {
    setSelectedExamples((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleMerge() {
    startTransition(async () => {
      setStatus("saving");
      try {
        const examples = allExamples
          .filter((e) => selectedExamples.has(e.id))
          .map((e, index) => ({
            sentence: e.sentence,
            sourceRawExampleId: e.id,
            position: index,
          }));
        await mergeSubmissions({
          rawSubmissionIds: submissions.map((s) => s.id),
          targetEntryId: null,
          word,
          dialectId,
          msaSynonyms: [msaSynonym],
          explanation,
          examples,
          referencePromptId:
            submissions.find((s) => s.reference_prompt_id)
              ?.reference_prompt_id ?? null,
        });
        router.push("/admin");
        router.refresh();
      } catch {
        setStatus("error");
      }
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <h1 className="text-xl font-bold">مساحة الدمج</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {submissions.map((s) => (
          <div
            key={s.id}
            className="border-border bg-surface rounded-2xl border p-4"
          >
            <h2 className="font-bold">{s.submitted_word}</h2>
            <p className="text-foreground/70 text-sm">
              اللهجة المُدخلة: {s.submitted_dialect}
            </p>
            <p className="text-foreground/70 text-sm">
              المرادف: {s.submitted_msa_synonym}
            </p>
            {s.submitted_explanation ? (
              <p className="text-foreground/70 text-sm">
                {s.submitted_explanation}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <section className="border-border bg-surface rounded-2xl border p-4">
        <h2 className="text-foreground/70 mb-3 text-sm font-bold">
          القيم الكنسية النهائية
        </h2>
        <div className="flex flex-col gap-3">
          <Field id="merge-word" label="الكلمة المعتمدة">
            <input
              id="merge-word"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            />
          </Field>
          <Field id="merge-dialect" label="اللهجة المعتمدة">
            <select
              id="merge-dialect"
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
          <Field id="merge-msa" label="المرادف الفصيح المعتمد">
            <input
              id="merge-msa"
              value={msaSynonym}
              onChange={(e) => setMsaSynonym(e.target.value)}
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            />
          </Field>
          <Field id="merge-explanation" label="الشرح المعتمد">
            <textarea
              id="merge-explanation"
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              rows={3}
              className="border-border bg-surface w-full rounded-lg border px-3 py-2"
            />
          </Field>
        </div>
      </section>

      <section className="border-border bg-surface rounded-2xl border p-4">
        <h2 className="text-foreground/70 mb-3 text-sm font-bold">
          اختر الأمثلة المفيدة من كل مصدر
        </h2>
        <ul className="flex flex-col gap-2">
          {allExamples.map((e) => (
            <li key={e.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                id={`ex-${e.id}`}
                checked={selectedExamples.has(e.id)}
                onChange={() => toggleExample(e.id)}
                className="mt-1"
              />
              <label htmlFor={`ex-${e.id}`}>
                {e.sentence}
                <span className="text-foreground/50">
                  {" "}
                  — من: {e.source.submitted_word}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {status === "error" ? (
        <p role="alert" className="text-danger text-sm">
          تعذّر إتمام الدمج. حاول مرة أخرى.
        </p>
      ) : null}

      <Button
        type="button"
        disabled={pending}
        onClick={handleMerge}
        className="self-start"
      >
        {pending ? "جارٍ الدمج…" : "إتمام الدمج"}
      </Button>
    </div>
  );
}
