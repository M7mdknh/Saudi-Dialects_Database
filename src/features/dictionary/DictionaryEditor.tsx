"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  getLastEditEventId,
  undoCanonicalEntryEdit,
  updateDictionaryEntry,
  type DictionaryEntryDetail,
} from "./actions";
import { createDialect } from "@/features/review/actions";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ALLOWED_REGISTERS } from "@/features/exports/projection";
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

interface ExampleFieldRow {
  key: string;
  id: string | null;
  sentence: string;
}

interface FieldErrors {
  word?: string;
  dialects?: string;
  examples?: string;
}

export function DictionaryEditor({
  entry,
  dialects,
}: {
  entry: DictionaryEntryDetail;
  dialects: DialectOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    "idle" | "saving" | "error" | "conflict" | "done"
  >("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [word, setWord] = useState(entry.word);
  const [meaning, setMeaning] = useState(entry.meaning ?? "");
  const [msaSynonyms, setMsaSynonyms] = useState<string[]>(entry.msaSynonyms);
  const [newSynonym, setNewSynonym] = useState("");
  const [relatedWords, setRelatedWords] = useState<string[]>(
    entry.relatedWords,
  );
  const [newRelatedWord, setNewRelatedWord] = useState("");
  const [conceptId, setConceptId] = useState(entry.conceptId ?? "");
  const [register, setRegister] = useState(entry.register ?? "");
  const [visibility, setVisibility] = useState<PublicVisibility>(
    entry.visibility,
  );
  const [selectedDialectIds, setSelectedDialectIds] = useState<Set<string>>(
    new Set(entry.dialectIds),
  );
  const [dialectOptions, setDialectOptions] =
    useState<DialectOption[]>(dialects);
  const [newLocalDialectStatus, setNewLocalDialectStatus] = useState<
    "idle" | "saving" | "error"
  >("idle");
  const [examples, setExamples] = useState<ExampleFieldRow[]>(
    entry.examples.map((e) => ({ key: e.id, id: e.id, sentence: e.sentence })),
  );
  const [newLocalDialect, setNewLocalDialect] = useState("");
  const [newLocalDialectMainGroup, setNewLocalDialectMainGroup] =
    useState<MainDialectGroupCode>("hijazi");

  function toggleDialect(id: string) {
    setSelectedDialectIds((prev) => {
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

  function addExample() {
    setExamples((prev) => [
      ...prev,
      { key: `new-${Date.now()}-${prev.length}`, id: null, sentence: "" },
    ]);
  }

  function removeExample(key: string) {
    setExamples((prev) => prev.filter((e) => e.key !== key));
  }

  function updateExampleSentence(key: string, sentence: string) {
    setExamples((prev) =>
      prev.map((e) => (e.key === key ? { ...e, sentence } : e)),
    );
  }

  function moveExample(key: string, direction: -1 | 1) {
    setExamples((prev) => {
      const index = prev.findIndex((e) => e.key === key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!word.trim()) errors.word = "الكلمة مطلوبة.";
    if (selectedDialectIds.size === 0)
      errors.dialects = "اختر لهجة رئيسية واحدة على الأقل.";
    const validExamples = examples.filter((e) => e.sentence.trim());
    if (validExamples.length === 0)
      errors.examples = "أضف مثالاً صالحاً واحداً على الأقل.";
    return errors;
  }

  function handleSave() {
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setStatus("saving");
    startTransition(async () => {
      try {
        const result = await updateDictionaryEntry({
          entryId: entry.id,
          expectedVersion: entry.version,
          word,
          meaning,
          msaSynonyms,
          dialectIds: [...selectedDialectIds],
          examples: examples
            .filter((e) => e.sentence.trim())
            .map((e, index) => ({
              id: e.id,
              sentence: e.sentence.trim(),
              position: index,
            })),
          relatedWords,
          conceptId: conceptId.trim() || null,
          register: register || null,
          visibility,
        });
        if (result.stale) {
          setStatus("conflict");
          return;
        }
        setStatus("done");
        router.push("/admin/dictionary");
        router.refresh();
      } catch {
        setStatus("error");
        setErrorMessage("تعذّر حفظ التحديث. حاول مرة أخرى.");
      }
    });
  }

  function handleUndo() {
    startTransition(async () => {
      try {
        const eventId = await getLastEditEventId(entry.id);
        if (!eventId) return;
        const result = await undoCanonicalEntryEdit(eventId, entry.version);
        if (result.stale) {
          setStatus("conflict");
          return;
        }
        router.refresh();
      } catch {
        setStatus("error");
        setErrorMessage("تعذّر التراجع عن آخر تعديل.");
      }
    });
  }

  const mainGroupDialects = dialectOptions.filter((d) => !d.parent_id);
  const localDialects = dialectOptions.filter((d) => d.parent_id);

  function handleAddLocalDialect() {
    const name = newLocalDialect.trim();
    if (!name) return;
    const parent = mainGroupDialects.find(
      (d) => d.main_group_code === newLocalDialectMainGroup,
    );
    if (!parent) return;
    setNewLocalDialectStatus("saving");
    startTransition(async () => {
      try {
        const created = await createDialect(name, parent.id);
        setDialectOptions((prev) => [
          ...prev,
          {
            id: created.id,
            name_ar: created.name_ar,
            main_group_code: newLocalDialectMainGroup,
            parent_id: parent.id,
          },
        ]);
        setSelectedDialectIds((prev) => new Set(prev).add(created.id));
        setNewLocalDialect("");
        setNewLocalDialectStatus("idle");
      } catch {
        setNewLocalDialectStatus("error");
      }
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <h1 className="text-xl font-bold">تحرير الكلمة المعتمدة</h1>

      {status === "conflict" ? (
        <div
          role="alert"
          className="border-danger bg-danger/10 text-danger rounded-xl border p-3 text-sm"
        >
          تغيّر هذا الكيان من قبل مشرف آخر منذ فتح الصفحة. أعد تحميل الصفحة
          لمراجعة أحدث نسخة قبل الحفظ مجدداً.
          <Button
            type="button"
            variant="ghost"
            className="mr-2"
            onClick={() => router.refresh()}
          >
            إعادة التحميل
          </Button>
        </div>
      ) : null}

      <section className="border-border bg-surface flex flex-col gap-3 rounded-2xl border p-4">
        <Field
          id="dict-edit-word"
          label="الكلمة"
          required
          error={fieldErrors.word}
        >
          <input
            id="dict-edit-word"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </Field>
        <Field id="dict-edit-key" label="المفتاح المشتق (تلقائي)">
          <input
            id="dict-edit-key"
            value={entry.wordKey}
            disabled
            dir="ltr"
            className="border-border bg-surface-muted min-h-11 w-full rounded-lg border px-3 py-2 opacity-70"
          />
        </Field>
        <Field id="dict-edit-meaning" label="المعنى">
          <textarea
            id="dict-edit-meaning"
            value={meaning}
            onChange={(e) => setMeaning(e.target.value)}
            rows={3}
            className="border-border bg-surface w-full rounded-lg border px-3 py-2"
          />
        </Field>
        <Field id="dict-edit-concept" label="معرّف المفهوم (اختياري)">
          <input
            id="dict-edit-concept"
            value={conceptId}
            onChange={(e) => setConceptId(e.target.value)}
            dir="ltr"
            className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </Field>
        <Field id="dict-edit-register" label="السجل اللغوي">
          <select
            id="dict-edit-register"
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
        <Field id="dict-edit-visibility" label="ظهور الكلمة">
          <select
            id="dict-edit-visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as PublicVisibility)}
            className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
          >
            <option value="public">عام</option>
            <option value="private">خاص</option>
          </select>
        </Field>
      </section>

      <section className="border-border bg-surface flex flex-col gap-3 rounded-2xl border p-4">
        <h2 className="text-foreground/70 text-sm font-bold">
          التصنيف اللهجي (اختر واحدة أو أكثر)
        </h2>
        {fieldErrors.dialects ? (
          <p className="text-danger text-sm">{fieldErrors.dialects}</p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {mainGroupDialects.map((d) => (
            <label key={d.id} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={selectedDialectIds.has(d.id)}
                onChange={() => toggleDialect(d.id)}
              />
              {d.main_group_code
                ? MAIN_GROUP_LABELS_AR[d.main_group_code]
                : d.name_ar}
            </label>
          ))}
        </div>
        <h3 className="text-foreground/70 text-sm font-semibold">
          اللهجات المحلية
        </h3>
        <div className="flex flex-wrap gap-3">
          {localDialects.map((d) => (
            <label key={d.id} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={selectedDialectIds.has(d.id)}
                onChange={() => toggleDialect(d.id)}
              />
              {d.name_ar}
              {d.main_group_code
                ? ` (${MAIN_GROUP_LABELS_AR[d.main_group_code]})`
                : ""}
            </label>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <Field id="dict-new-local-dialect" label="لهجة محلية جديدة">
            <input
              id="dict-new-local-dialect"
              value={newLocalDialect}
              onChange={(e) => setNewLocalDialect(e.target.value)}
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
            />
          </Field>
          <select
            value={newLocalDialectMainGroup}
            onChange={(e) =>
              setNewLocalDialectMainGroup(
                e.target.value as MainDialectGroupCode,
              )
            }
            className="border-border bg-surface min-h-11 rounded-lg border px-2"
          >
            {(Object.keys(MAIN_GROUP_LABELS_AR) as MainDialectGroupCode[]).map(
              (g) => (
                <option key={g} value={g}>
                  {MAIN_GROUP_LABELS_AR[g]}
                </option>
              ),
            )}
          </select>
          <Button
            type="button"
            variant="secondary"
            disabled={pending || !newLocalDialect.trim()}
            onClick={handleAddLocalDialect}
          >
            إضافة واختيار
          </Button>
        </div>
        {newLocalDialectStatus === "error" ? (
          <p role="alert" className="text-danger text-sm">
            تعذّر إضافة اللهجة المحلية. حاول مرة أخرى.
          </p>
        ) : null}
      </section>

      <section className="border-border bg-surface flex flex-col gap-3 rounded-2xl border p-4">
        <h2 className="text-foreground/70 text-sm font-bold">
          المرادفات الفصيحة
        </h2>
        <ul className="flex flex-wrap gap-2">
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
      </section>

      <section className="border-border bg-surface flex flex-col gap-3 rounded-2xl border p-4">
        <h2 className="text-foreground/70 text-sm font-bold">كلمات ذات صلة</h2>
        <ul className="flex flex-wrap gap-2">
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
          <Button type="button" variant="secondary" onClick={addRelatedWord}>
            إضافة
          </Button>
        </div>
      </section>

      <section className="border-border bg-surface flex flex-col gap-3 rounded-2xl border p-4">
        <h2 className="text-foreground/70 text-sm font-bold">الأمثلة</h2>
        {fieldErrors.examples ? (
          <p className="text-danger text-sm">{fieldErrors.examples}</p>
        ) : null}
        <ul
          className="flex flex-col gap-2"
          data-testid="dictionary-examples-list"
        >
          {examples.map((e, index) => (
            <li key={e.key} className="flex items-center gap-2">
              <input
                value={e.sentence}
                onChange={(ev) => updateExampleSentence(e.key, ev.target.value)}
                className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
              />
              <Button
                type="button"
                variant="ghost"
                disabled={index === 0}
                onClick={() => moveExample(e.key, -1)}
                aria-label="نقل لأعلى"
              >
                ↑
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={index === examples.length - 1}
                onClick={() => moveExample(e.key, 1)}
                aria-label="نقل لأسفل"
              >
                ↓
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => removeExample(e.key)}
                aria-label="حذف المثال"
              >
                حذف
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="secondary"
          onClick={addExample}
          className="self-start"
        >
          إضافة مثال
        </Button>
      </section>

      {status === "error" ? (
        <p role="alert" className="text-danger text-sm">
          {errorMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={handleSave}>
          {pending && status === "saving" ? "جارٍ الحفظ…" : "حفظ ونشر التحديث"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={handleUndo}
        >
          تراجع عن آخر تعديل
        </Button>
      </div>
    </div>
  );
}
