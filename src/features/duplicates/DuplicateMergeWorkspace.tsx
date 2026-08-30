"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  mergeDuplicateGroup,
  reopenDuplicateGroup,
  resolveDuplicateGroup,
  splitDuplicateGroupIntoWords,
  type DuplicateGroupMember,
  type DuplicateGroupRow,
} from "./actions";
import { countMainDialects, pickDefaultMainDialect } from "./dialect-selection";
import {
  CANDIDATE_TYPE_LABELS_AR,
  MAIN_GROUP_LABELS_AR,
  REGISTER_LABELS_AR,
  RESOLUTION_STATUS_LABELS_AR,
  formatSourceCount,
} from "./labels";
import { buildDefaultSplitBuckets, type SplitBucket } from "./split-groups";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ALLOWED_REGISTERS } from "@/features/exports/projection";
import { toSearchKey } from "@/lib/text/normalize-arabic";
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

interface ExampleRow {
  id: string;
  sentence: string;
  sourceMemberId: string;
  sourceWord: string;
  sourceType: "raw" | "canonical";
}

function memberLabel(m: DuplicateGroupMember): string {
  return m.memberType === "canonical" ? "الكيان المعتمد الحالي" : m.word;
}

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

  const mainGroupDialectRow = useMemo(() => {
    const map = new Map<MainDialectGroupCode, DialectOption>();
    for (const d of dialects) {
      if (!d.parent_id && d.main_group_code) map.set(d.main_group_code, d);
    }
    return map;
  }, [dialects]);

  const mainDialectCounts = useMemo(
    () =>
      countMainDialects(
        rawMembers.map((m) => ({ mainGroupCode: m.mainGroupCode })),
      ),
    [rawMembers],
  );

  // --- Base candidate: which source's content pre-fills the editable
  // fields below. Real state (not a derived/recomputed condition), so it
  // survives rerenders and unrelated field edits — see the regression test
  // for the bug this replaces (every raw candidate's radio always
  // rendered "checked" based on rawMembers[0] regardless of which one was
  // actually clicked).
  const [selectedBaseId, setSelectedBaseId] = useState<string>(
    () =>
      canonicalMember?.memberId ??
      rawMembers[0]?.memberId ??
      members[0]?.memberId ??
      "",
  );
  const selectedBaseMember = members.find((m) => m.memberId === selectedBaseId);

  // Merging into the existing canonical entry vs. creating a new one is a
  // separate choice from "which source's wording to start from" — picking
  // a raw candidate as the content basis does not, by itself, mean giving
  // up the existing canonical entry as the record being updated.
  const [mergeIntoExisting, setMergeIntoExisting] = useState(!!canonicalMember);
  const targetEntryId =
    canonicalMember && mergeIntoExisting ? canonicalMember.memberId : null;

  const [word, setWord] = useState(selectedBaseMember?.word ?? row.word);
  const [explanation, setExplanation] = useState(
    selectedBaseMember?.meaning ?? "",
  );
  const [msaSynonyms, setMsaSynonyms] = useState<string[]>(
    selectedBaseMember?.msaSynonyms ?? [],
  );
  const [newSynonym, setNewSynonym] = useState("");
  const [conceptId, setConceptId] = useState(
    selectedBaseMember?.conceptId ?? "",
  );
  const [register, setRegister] = useState(selectedBaseMember?.register ?? "");

  const [relatedWords, setRelatedWords] = useState<string[]>(() => [
    ...new Set(members.flatMap((m) => m.relatedWords)),
  ]);
  const [newRelatedWord, setNewRelatedWord] = useState("");
  const [visibility, setVisibility] = useState<PublicVisibility>(
    canonicalMember?.publicVisibility ?? "public",
  );

  // --- Dialect multi-select: preserve everything the existing canonical
  // entry already has, plus the deterministically-preselected majority
  // main dialect among the raw candidates (never removed automatically).
  const [selectedDialectIds, setSelectedDialectIds] = useState<Set<string>>(
    () => {
      const defaultCode = pickDefaultMainDialect({
        counts: mainDialectCounts,
        canonicalPrimaryCode: canonicalMember?.mainGroupCode ?? null,
        baseCandidateCode: selectedBaseMember?.mainGroupCode ?? null,
      });
      const ids = new Set<string>(canonicalMember?.dialectIds ?? []);
      const defaultRow = defaultCode
        ? mainGroupDialectRow.get(defaultCode)
        : null;
      if (defaultRow) ids.add(defaultRow.id);
      return ids;
    },
  );

  function toggleDialect(id: string) {
    setSelectedDialectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectBase(m: DuplicateGroupMember) {
    setSelectedBaseId(m.memberId);
    setWord(m.word);
    setExplanation(m.meaning ?? "");
    setMsaSynonyms(m.msaSynonyms);
    setConceptId(m.conceptId ?? "");
    setRegister(m.register ?? "");
    // Examples and dialect assignments are managed independently (below)
    // and are never discarded or reset by changing the content basis.
  }

  const allExamples: ExampleRow[] = useMemo(
    () =>
      members.flatMap((m) =>
        m.examples.map((e) => ({
          id: e.id,
          sentence: e.sentence,
          sourceMemberId: m.memberId,
          sourceWord: memberLabel(m),
          sourceType: m.memberType,
        })),
      ),
    [members],
  );

  const duplicateSentenceKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of allExamples) {
      const key = toSearchKey(e.sentence);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set(
      [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k),
    );
  }, [allExamples]);

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

  const examplesBySource = useMemo(() => {
    const groups = new Map<string, ExampleRow[]>();
    for (const e of allExamples) {
      const list = groups.get(e.sourceMemberId) ?? [];
      list.push(e);
      groups.set(e.sourceMemberId, list);
    }
    return groups;
  }, [allExamples]);

  function toggleSourceExamples(sourceMemberId: string) {
    const groupIds = (examplesBySource.get(sourceMemberId) ?? []).map(
      (e) => e.id,
    );
    const allSelected = groupIds.every((id) => selectedExampleIds.has(id));
    setSelectedExampleIds((prev) => {
      const next = new Set(prev);
      for (const id of groupIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
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
          dialectIds: [...selectedDialectIds],
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

  // --- "فصل إلى كلمات مستقلة": distinct word forms (e.g. جب / جيب) that
  // showed up in the same duplicate group by meaning or spelling similarity
  // must never be forced into one canonical entry. Default buckets group
  // members by their own word_key; the admin may only edit each bucket's
  // fields, never merge two buckets' word_keys into one.
  const defaultSplitBuckets = useMemo(
    () => buildDefaultSplitBuckets(members),
    [members],
  );
  const [showSplit, setShowSplit] = useState(false);
  const [splitBuckets, setSplitBuckets] = useState<SplitBucket[]>(
    defaultSplitBuckets,
  );
  const [sharedConceptId, setSharedConceptId] = useState("");
  const [splitStatus, setSplitStatus] = useState<
    "idle" | "saving" | "error" | "done"
  >("idle");
  const [splitError, setSplitError] = useState("");

  function openSplit() {
    setSplitBuckets(defaultSplitBuckets);
    setSharedConceptId(conceptId.trim());
    setSplitError("");
    setSplitStatus("idle");
    setShowSplit(true);
  }

  function updateBucket(index: number, patch: Partial<SplitBucket>) {
    setSplitBuckets((prev) =>
      prev.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    );
  }

  function toggleBucketDialect(index: number, dialectId: string) {
    setSplitBuckets((prev) =>
      prev.map((b, i) => {
        if (i !== index) return b;
        const has = b.dialectIds.includes(dialectId);
        return {
          ...b,
          dialectIds: has
            ? b.dialectIds.filter((id) => id !== dialectId)
            : [...b.dialectIds, dialectId],
        };
      }),
    );
  }

  const splitWordKeys = splitBuckets.map((b) => toSearchKey(b.word));
  const hasDuplicateSplitKeys =
    new Set(splitWordKeys).size !== splitWordKeys.length;
  const hasEmptySplitDialects = splitBuckets.some(
    (b) => b.dialectIds.length === 0,
  );

  function handleSplit() {
    setSplitStatus("saving");
    startTransition(async () => {
      try {
        const entryIds = await splitDuplicateGroupIntoWords({
          groupKey: row.groupKey,
          memberSignature: row.memberSignature,
          conceptId: sharedConceptId.trim() || null,
          words: splitBuckets.map((b) => ({
            word: b.word,
            wordSearchKey: toSearchKey(b.word),
            targetEntryId: b.targetEntryId,
            expectedVersion: b.expectedVersion,
            dialectIds: b.dialectIds,
            msaSynonyms: b.msaSynonyms,
            explanation: b.explanation,
            relatedWords: b.relatedWords,
            register: b.register,
            visibility: b.visibility,
            referencePromptId: b.referencePromptId,
            rawSubmissionIds: b.rawSubmissionIds,
            examples: b.examples.map((e, index) => ({
              sentence: e.sentence,
              sourceRawExampleId: e.sourceType === "raw" ? e.id : null,
              position: index,
            })),
            removedCanonicalExampleIds: [],
          })),
        });
        setSplitStatus("done");
        router.push(`/admin/duplicates?split=${entryIds.join(",")}`);
        router.refresh();
      } catch (error) {
        setSplitStatus("error");
        setSplitError(
          (error as { message?: string })?.message?.includes("stale")
            ? "تغيّر أحد الكيانات من قبل مشرف آخر. أعد تحميل الصفحة وحاول مجدداً."
            : "تعذّر إتمام الفصل. حاول مرة أخرى.",
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

  const selectedDialectLabels = [...selectedDialectIds]
    .map((id) => dialects.find((d) => d.id === id))
    .filter((d): d is DialectOption => !!d)
    .map((d) =>
      d.parent_id ? d.name_ar : MAIN_GROUP_LABELS_AR[d.main_group_code!],
    );

  const mainGroupDialects = dialects.filter((d) => !d.parent_id);
  const localDialects = dialects.filter((d) => d.parent_id);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-24">
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

      {/* 1. اختيار الأساس */}
      <section className="border-border bg-surface rounded-2xl border p-4">
        <h2 className="text-foreground/70 mb-3 text-sm font-bold">
          اختيار الأساس
        </h2>
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          data-testid="base-candidates"
        >
          {members.map((m) => {
            const isSelected = selectedBaseId === m.memberId;
            return (
              <button
                key={m.memberId}
                type="button"
                aria-pressed={isSelected}
                onClick={() => selectBase(m)}
                className={`flex flex-col gap-1 rounded-xl border-2 p-3 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  isSelected
                    ? "border-accent bg-accent/10"
                    : "border-border hover:bg-surface-muted"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">{m.word}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      isSelected
                        ? "bg-accent text-accent-foreground"
                        : "bg-surface-muted"
                    }`}
                  >
                    {isSelected ? "الأساس المختار ✓" : "اختيار كأساس"}
                  </span>
                </div>
                {m.memberType === "canonical" ? (
                  <span className="text-foreground/60 text-xs">
                    كيان معتمد حالياً
                  </span>
                ) : null}
                <p className="text-foreground/70 text-xs">
                  {m.mainGroupCode
                    ? MAIN_GROUP_LABELS_AR[m.mainGroupCode]
                    : "—"}
                  {m.localDialectLabel ? ` (${m.localDialectLabel})` : ""}
                </p>
                {m.meaning ? (
                  <p className="text-foreground/70 line-clamp-2 text-xs">
                    {m.meaning}
                  </p>
                ) : null}
              </button>
            );
          })}
        </div>
        {canonicalMember ? (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mergeIntoExisting}
              onChange={(e) => setMergeIntoExisting(e.target.checked)}
            />
            الدمج داخل الكيان المعتمد الحالي (بدل إنشاء كيان جديد)
          </label>
        ) : null}
      </section>

      {/* 2. بيانات الكلمة النهائية */}
      <section className="border-border bg-surface flex flex-col gap-3 rounded-2xl border p-4">
        <h2 className="text-foreground/70 text-sm font-bold">
          بيانات الكلمة النهائية
        </h2>
        <Field id="dup-merge-word" label="الكلمة المعتمدة">
          <input
            id="dup-merge-word"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
          />
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

        {/* اللهجات التي تُستخدم فيها الكلمة */}
        <div>
          <p className="mb-1 text-sm font-semibold">
            اللهجات التي تُستخدم فيها الكلمة
          </p>
          {selectedDialectIds.size === 0 ? (
            <p className="text-danger text-sm">
              اختر لهجة رئيسية واحدة على الأقل.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {mainGroupDialects.map((d) => {
              const code = d.main_group_code!;
              const count = mainDialectCounts[code] ?? 0;
              const isChecked = selectedDialectIds.has(d.id);
              return (
                <label
                  key={d.id}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
                    isChecked ? "border-accent bg-accent/10" : "border-border"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleDialect(d.id)}
                  />
                  {MAIN_GROUP_LABELS_AR[code]}
                  {count > 0 ? (
                    <span className="text-foreground/60 text-xs">
                      — {formatSourceCount(count)}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
          {localDialects.length > 0 ? (
            <>
              <p className="text-foreground/60 mt-2 mb-1 text-xs font-semibold">
                لهجات محلية مكتشفة
              </p>
              <div className="flex flex-wrap gap-2">
                {localDialects
                  .filter(
                    (d) =>
                      selectedDialectIds.has(d.id) ||
                      members.some((m) => m.dialectIds.includes(d.id)),
                  )
                  .map((d) => {
                    const isChecked = selectedDialectIds.has(d.id);
                    const count = rawMembers.filter((m) =>
                      m.dialectIds.includes(d.id),
                    ).length;
                    return (
                      <label
                        key={d.id}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
                          isChecked
                            ? "border-accent bg-accent/10"
                            : "border-border"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleDialect(d.id)}
                        />
                        {d.name_ar}
                        {count > 0 ? (
                          <span className="text-foreground/60 text-xs">
                            — {formatSourceCount(count)}
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
              </div>
            </>
          ) : null}
        </div>

        <Field id="dup-merge-visibility" label="ظهور الكلمة">
          <select
            id="dup-merge-visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as PublicVisibility)}
            className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
          >
            <option value="public">عام</option>
            <option value="private">خاص</option>
          </select>
        </Field>
      </section>

      {/* 3. الأمثلة */}
      <section className="border-border bg-surface flex flex-col gap-4 rounded-2xl border p-4">
        <h2 className="text-foreground/70 text-sm font-bold">الأمثلة</h2>
        {[...examplesBySource.entries()].map(([sourceMemberId, group]) => {
          const allSelected = group.every((e) => selectedExampleIds.has(e.id));
          return (
            <div key={sourceMemberId} className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">
                  {group[0]?.sourceWord}
                  {group[0]?.sourceType === "canonical" ? " (كيان معتمد)" : ""}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-xs"
                  onClick={() => toggleSourceExamples(sourceMemberId)}
                >
                  {allSelected ? "إلغاء تحديد الكل" : "تحديد الكل"}
                </Button>
              </div>
              <ul className="flex flex-col gap-2">
                {group.map((e) => {
                  const isDuplicate = duplicateSentenceKeys.has(
                    toSearchKey(e.sentence),
                  );
                  return (
                    <li key={e.id} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        id={`dup-ex-${e.id}`}
                        checked={selectedExampleIds.has(e.id)}
                        onChange={() => toggleExample(e.id)}
                        className="mt-2"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
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
                          {isDuplicate ? (
                            <span className="bg-danger/10 text-danger shrink-0 rounded-full px-2 py-0.5 text-xs">
                              مكرر
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>

      {/* 4. حقول إضافية (collapsible) */}
      <details className="border-border bg-surface rounded-2xl border p-4">
        <summary className="text-foreground/70 cursor-pointer text-sm font-bold">
          حقول إضافية
        </summary>
        <div className="mt-3 flex flex-col gap-3">
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
        </div>
      </details>

      {status === "error" ? (
        <p role="alert" className="text-danger text-sm">
          {errorMessage}
        </p>
      ) : null}

      {/* Sticky summary + primary action */}
      <div className="border-border bg-surface sticky bottom-0 flex flex-col gap-2 rounded-2xl border p-4 shadow-lg">
        <dl className="text-foreground/70 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-foreground/50">الكلمة</dt>
            <dd className="text-foreground font-semibold">{word || "—"}</dd>
          </div>
          <div>
            <dt className="text-foreground/50">اللهجات</dt>
            <dd className="text-foreground font-semibold">
              {selectedDialectLabels.join("، ") || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-foreground/50">الأمثلة المحدَّدة</dt>
            <dd className="text-foreground font-semibold">
              {previewExamples.length}
            </dd>
          </div>
          <div>
            <dt className="text-foreground/50">المصادر المدموجة</dt>
            <dd className="text-foreground font-semibold">{members.length}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={
              pending ||
              previewExamples.length === 0 ||
              selectedDialectIds.size === 0
            }
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
              {defaultSplitBuckets.length > 1 ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={openSplit}
                >
                  فصل إلى كلمات مستقلة
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {showSplit ? (
        <section
          className="border-border bg-surface flex flex-col gap-4 rounded-2xl border p-4"
          data-testid="split-workspace"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-foreground/70 text-sm font-bold">
              فصل إلى كلمات مستقلة
            </h2>
            <Button type="button" variant="ghost" onClick={() => setShowSplit(false)}>
              إغلاق
            </Button>
          </div>
          <p className="text-foreground/60 text-xs">
            كل كلمة أدناه ستبقى كيانًا معتمدًا مستقلًا بلهجاته الخاصة. يمكنك
            ربطها بمعرّف مفهوم مشترك دون دمجها في كلمة واحدة.
          </p>

          <Field id="dup-split-concept" label="معرّف المفهوم المشترك (اختياري)">
            <input
              id="dup-split-concept"
              value={sharedConceptId}
              onChange={(e) => setSharedConceptId(e.target.value)}
              className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
              dir="ltr"
            />
          </Field>

          <div className="flex flex-col gap-4">
            {splitBuckets.map((bucket, index) => (
              <div
                key={bucket.wordKey || index}
                className="border-border rounded-xl border p-3"
                data-testid={`split-bucket-${index}`}
              >
                <Field
                  id={`dup-split-word-${index}`}
                  label={`الكلمة ${index + 1}`}
                >
                  <input
                    id={`dup-split-word-${index}`}
                    value={bucket.word}
                    onChange={(e) =>
                      updateBucket(index, { word: e.target.value })
                    }
                    className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
                  />
                </Field>
                <Field
                  id={`dup-split-explanation-${index}`}
                  label="المعنى"
                >
                  <textarea
                    id={`dup-split-explanation-${index}`}
                    value={bucket.explanation}
                    onChange={(e) =>
                      updateBucket(index, { explanation: e.target.value })
                    }
                    rows={2}
                    className="border-border bg-surface w-full rounded-lg border px-3 py-2"
                  />
                </Field>
                <div className="mt-2">
                  <p className="mb-1 text-sm font-semibold">اللهجات</p>
                  {bucket.dialectIds.length === 0 ? (
                    <p className="text-danger text-sm">
                      اختر لهجة رئيسية واحدة على الأقل لهذه الكلمة.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {mainGroupDialects.map((d) => {
                      const code = d.main_group_code!;
                      const isChecked = bucket.dialectIds.includes(d.id);
                      return (
                        <label
                          key={d.id}
                          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
                            isChecked
                              ? "border-accent bg-accent/10"
                              : "border-border"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleBucketDialect(index, d.id)}
                          />
                          {MAIN_GROUP_LABELS_AR[code]}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <p className="text-foreground/60 mt-2 text-xs">
                  الأمثلة: {bucket.examples.length} — المصادر:{" "}
                  {bucket.rawSubmissionIds.length +
                    (bucket.targetEntryId ? 1 : 0)}
                </p>
              </div>
            ))}
          </div>

          {hasDuplicateSplitKeys ? (
            <p role="alert" className="text-danger text-sm">
              لا يمكن أن تشترك كلمتان في نفس الإملاء عند الفصل. عدّل الكلمة
              لتمييزها.
            </p>
          ) : null}
          {splitStatus === "error" ? (
            <p role="alert" className="text-danger text-sm">
              {splitError}
            </p>
          ) : null}

          <Button
            type="button"
            disabled={
              pending || hasDuplicateSplitKeys || hasEmptySplitDialects
            }
            onClick={handleSplit}
          >
            {pending && splitStatus === "saving"
              ? "جارٍ الفصل…"
              : "تأكيد الفصل"}
          </Button>
        </section>
      ) : null}
    </div>
  );
}
