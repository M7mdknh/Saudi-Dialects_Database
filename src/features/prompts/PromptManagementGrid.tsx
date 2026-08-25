"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { upsertReferencePrompt } from "./actions";
import { Button } from "@/components/ui/Button";

interface PromptRow {
  id: string;
  category: string;
  category_label_ar: string;
  msa_lemma: string;
  definition_ar: string;
  scenario_ar: string;
  part_of_speech: string;
  answer_form: string;
  priority: number;
  prompt_version: number;
  is_active: boolean;
  submission_count: number;
}

interface PromptManagementGridProps {
  rows: PromptRow[];
  total: number;
  page: number;
  pageSize: number;
  search?: string;
  category?: string;
  status?: "active" | "inactive";
  categories: { id: string; label_ar: string }[];
}

type DraftState = Record<
  string,
  { msaLemma: string; definitionAr: string; scenarioAr: string }
>;

export function PromptManagementGrid({
  rows,
  total,
  page,
  pageSize,
  search,
  category,
  status,
  categories,
}: PromptManagementGridProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<DraftState>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function updateParams(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function draftFor(row: PromptRow) {
    return (
      drafts[row.id] ?? {
        msaLemma: row.msa_lemma,
        definitionAr: row.definition_ar,
        scenarioAr: row.scenario_ar,
      }
    );
  }

  function setDraft(
    id: string,
    field: keyof DraftState[string],
    value: string,
  ) {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? draftFor(rows.find((r) => r.id === id)!)),
        [field]: value,
      },
    }));
  }

  function save(row: PromptRow) {
    const draft = draftFor(row);
    setSavingId(row.id);
    startTransition(async () => {
      try {
        const result = await upsertReferencePrompt({
          id: row.id,
          expectedPromptVersion: row.prompt_version,
          category: row.category,
          categoryLabelAr: row.category_label_ar,
          msaLemma: draft.msaLemma,
          definitionAr: draft.definitionAr,
          scenarioAr: draft.scenarioAr,
          partOfSpeech: row.part_of_speech,
          answerForm: row.answer_form,
          priority: row.priority,
          isActive: row.is_active,
        });
        if (result.stale) {
          setMessages((m) => ({
            ...m,
            [row.id]: "تغيّر هذا المحتوى من قبل مشرف آخر. أعد تحميل الصفحة.",
          }));
        } else {
          setMessages((m) => ({ ...m, [row.id]: "تم الحفظ." }));
          router.refresh();
        }
      } catch {
        setMessages((m) => ({ ...m, [row.id]: "تعذّر الحفظ. حاول مرة أخرى." }));
      } finally {
        setSavingId(null);
      }
    });
  }

  function toggleActive(row: PromptRow) {
    setSavingId(row.id);
    startTransition(async () => {
      try {
        await upsertReferencePrompt({
          id: row.id,
          expectedPromptVersion: row.prompt_version,
          category: row.category,
          categoryLabelAr: row.category_label_ar,
          msaLemma: row.msa_lemma,
          definitionAr: row.definition_ar,
          scenarioAr: row.scenario_ar,
          partOfSpeech: row.part_of_speech,
          answerForm: row.answer_form,
          priority: row.priority,
          isActive: !row.is_active,
        });
        router.refresh();
      } finally {
        setSavingId(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          defaultValue={search ?? ""}
          placeholder="ابحث في المفاهيم"
          className="border-border bg-surface min-h-11 min-w-48 rounded-lg border px-3 py-2 text-base"
          onKeyDown={(e) => {
            if (e.key === "Enter")
              updateParams({
                q: (e.target as HTMLInputElement).value,
                page: undefined,
              });
          }}
        />
        <select
          value={category ?? ""}
          onChange={(e) =>
            updateParams({
              category: e.target.value || undefined,
              page: undefined,
            })
          }
          className="border-border bg-surface min-h-11 rounded-lg border px-3 py-2 text-sm"
          aria-label="تصفية حسب التصنيف"
        >
          <option value="">كل التصنيفات</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label_ar}
            </option>
          ))}
        </select>
        <select
          value={status ?? ""}
          onChange={(e) =>
            updateParams({
              status: e.target.value || undefined,
              page: undefined,
            })
          }
          className="border-border bg-surface min-h-11 rounded-lg border px-3 py-2 text-sm"
          aria-label="تصفية حسب الحالة"
        >
          <option value="">كل الحالات</option>
          <option value="active">نشط</option>
          <option value="inactive">غير نشط</option>
        </select>
      </div>

      <div
        className="border-border overflow-x-auto rounded-xl border"
        dir="rtl"
      >
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-border bg-surface-muted border-b text-right">
              <th className="p-2">المفهوم</th>
              <th className="p-2">المعنى</th>
              <th className="p-2">السيناريو</th>
              <th className="p-2">التصنيف</th>
              <th className="p-2">المساهمات</th>
              <th className="p-2">الحالة</th>
              <th className="p-2">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-foreground/60 p-6 text-center">
                  لا توجد نتائج مطابقة.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const draft = draftFor(row);
                const dirty =
                  draft.msaLemma !== row.msa_lemma ||
                  draft.definitionAr !== row.definition_ar ||
                  draft.scenarioAr !== row.scenario_ar;
                return (
                  <tr
                    key={row.id}
                    className="border-border border-b align-top last:border-0"
                  >
                    <td className="p-2">
                      <input
                        value={draft.msaLemma}
                        onChange={(e) =>
                          setDraft(row.id, "msaLemma", e.target.value)
                        }
                        className="border-border bg-surface min-h-11 w-32 rounded-lg border px-2 py-1"
                        aria-label={`المفهوم — ${row.id}`}
                      />
                    </td>
                    <td className="p-2">
                      <textarea
                        value={draft.definitionAr}
                        onChange={(e) =>
                          setDraft(row.id, "definitionAr", e.target.value)
                        }
                        rows={2}
                        className="border-border bg-surface min-w-56 rounded-lg border px-2 py-1"
                        aria-label={`المعنى — ${row.id}`}
                      />
                    </td>
                    <td className="p-2">
                      <textarea
                        value={draft.scenarioAr}
                        onChange={(e) =>
                          setDraft(row.id, "scenarioAr", e.target.value)
                        }
                        rows={2}
                        className="border-border bg-surface min-w-56 rounded-lg border px-2 py-1"
                        aria-label={`السيناريو — ${row.id}`}
                      />
                    </td>
                    <td className="text-foreground/70 p-2">
                      {row.category_label_ar}
                    </td>
                    <td className="p-2">
                      {row.submission_count > 0 ? (
                        <span className="text-foreground font-semibold">
                          {row.submission_count}
                        </span>
                      ) : (
                        <span className="bg-surface-muted text-foreground/60 rounded-full px-2 py-0.5 text-xs">
                          لا توجد مساهمات
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      <button
                        type="button"
                        onClick={() => toggleActive(row)}
                        disabled={pending && savingId === row.id}
                        className={`min-h-9 rounded-full px-3 py-1 text-xs font-semibold ${
                          row.is_active
                            ? "bg-success/15 text-success"
                            : "bg-surface-muted text-foreground/60"
                        }`}
                      >
                        {row.is_active ? "نشط" : "غير نشط"}
                      </button>
                    </td>
                    <td className="p-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-h-9 px-3 text-xs"
                        disabled={!dirty || (pending && savingId === row.id)}
                        onClick={() => save(row)}
                      >
                        حفظ
                      </Button>
                      {messages[row.id] ? (
                        <p
                          role="status"
                          className="text-foreground/60 mt-1 text-xs"
                        >
                          {messages[row.id]}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                );
              })
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
}
