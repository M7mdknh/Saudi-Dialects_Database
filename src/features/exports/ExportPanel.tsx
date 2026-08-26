"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

interface DialectOption {
  id: string;
  name_ar: string;
}

interface PreviewResult {
  recordCount: number;
  schemaVersion: number;
  totalApprovedCount: number;
  missingSynonymCount: number;
  awaitingApprovalCount: number;
  excludedByFiltersCount: number;
}

interface PreviewResultV4 {
  recordCount: number;
  schemaVersion: 4;
  countsByMainDialect: Record<string, number>;
  missingMeaningCount: number;
  missingSynonymCount: number;
  excludedInvalidExampleCount: number;
  excludedEntries: { id: string; word: string }[];
}

const SCHEMA_LABELS: Record<"1" | "2" | "3" | "4", string> = {
  "1": "الإصدار ١ (الافتراضي والثابت)",
  "2": "الإصدار ٢ (يضيف تصنيف اللهجة الرئيسية والمفهوم المرجعي)",
  "3": "الإصدار ٣ — قاموس اللهجات السعودية",
  "4": "الإصدار ٤ — القاموس المبسّط للتدريب (موصى به)",
};

const MAIN_GROUP_LABELS_AR: Record<string, string> = {
  hijazi: "حجازي",
  najdi: "نجدي",
  eastern: "شرقاوي",
  northern: "شمالي",
  southern: "جنوبي",
};

type VisibilityFilter = "all" | "public" | "private";

const VISIBILITY_LABELS: Record<VisibilityFilter, string> = {
  all: "الكل",
  public: "عام فقط",
  private: "خاص فقط",
};

export function ExportPanel({ dialects }: { dialects: DialectOption[] }) {
  const [dialectId, setDialectId] = useState("");
  const [updatedFrom, setUpdatedFrom] = useState("");
  const [updatedTo, setUpdatedTo] = useState("");
  const [schemaVersion, setSchemaVersion] = useState<"1" | "2" | "3" | "4">(
    "4",
  );
  const [visibility, setVisibility] = useState<VisibilityFilter>("all");
  const [preview, setPreview] = useState<
    PreviewResult | PreviewResultV4 | null
  >(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  const hasFilters = Boolean(
    dialectId || updatedFrom || updatedTo || visibility !== "all",
  );

  function buildQuery(extra: Record<string, string>) {
    const params = new URLSearchParams();
    if (dialectId) params.set("dialectId", dialectId);
    if (updatedFrom)
      params.set("updatedFrom", new Date(updatedFrom).toISOString());
    if (updatedTo) params.set("updatedTo", new Date(updatedTo).toISOString());
    params.set("schemaVersion", schemaVersion);
    params.set("visibility", visibility);
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
    return params.toString();
  }

  function clearFilters() {
    setDialectId("");
    setUpdatedFrom("");
    setUpdatedTo("");
    setVisibility("all");
    setPreview(null);
  }

  async function handlePreview() {
    setStatus("loading");
    try {
      const res = await fetch(
        `/api/admin/exports?${buildQuery({ preview: "1" })}`,
      );
      if (!res.ok) throw new Error();
      setPreview(await res.json());
      setStatus("idle");
    } catch {
      setPreview(null);
      setStatus("error");
    }
  }

  function handleDownload(format: "json" | "jsonl" | "allam") {
    // File download from our own API route (Content-Disposition: attachment),
    // not an internal page navigation, so this intentionally bypasses the
    // Next.js router.
    window.open(`/api/admin/exports?${buildQuery({ format })}`, "_blank");
  }

  const isV4 = schemaVersion === "4";
  const previewV4 = isV4 ? (preview as PreviewResultV4 | null) : null;
  const previewLegacy = !isV4 ? (preview as PreviewResult | null) : null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <h1 className="text-xl font-bold">تصدير البيانات</h1>

      <Field id="export-schema-version" label="إصدار مخطط التصدير">
        <select
          id="export-schema-version"
          value={schemaVersion}
          onChange={(e) => {
            setSchemaVersion(e.target.value as "1" | "2" | "3" | "4");
            setPreview(null);
          }}
          className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
        >
          <option value="4">{SCHEMA_LABELS["4"]}</option>
          <option value="3">{SCHEMA_LABELS["3"]}</option>
          <option value="2">{SCHEMA_LABELS["2"]}</option>
          <option value="1">{SCHEMA_LABELS["1"]}</option>
        </select>
      </Field>

      <Field id="export-dialect" label="اللهجة المعتمدة">
        <select
          id="export-dialect"
          value={dialectId}
          onChange={(e) => {
            setDialectId(e.target.value);
            setPreview(null);
          }}
          className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
        >
          <option value="">كل اللهجات</option>
          {dialects.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name_ar}
            </option>
          ))}
        </select>
      </Field>
      <Field id="export-visibility" label="ظهور الكلمات">
        <select
          id="export-visibility"
          value={visibility}
          onChange={(e) => {
            setVisibility(e.target.value as VisibilityFilter);
            setPreview(null);
          }}
          className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
        >
          {(Object.keys(VISIBILITY_LABELS) as VisibilityFilter[]).map((v) => (
            <option key={v} value={v}>
              {VISIBILITY_LABELS[v]}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="updated-from" label="من تاريخ التحديث">
          <input
            id="updated-from"
            type="date"
            value={updatedFrom}
            onChange={(e) => {
              setUpdatedFrom(e.target.value);
              setPreview(null);
            }}
            className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </Field>
        <Field id="updated-to" label="إلى تاريخ التحديث">
          <input
            id="updated-to"
            type="date"
            value={updatedTo}
            onChange={(e) => {
              setUpdatedTo(e.target.value);
              setPreview(null);
            }}
            className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </Field>
      </div>

      {hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          className="self-start text-sm"
          onClick={clearFilters}
        >
          مسح الفلاتر
        </Button>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        disabled={status === "loading"}
        onClick={handlePreview}
      >
        معاينة عدد السجلات
      </Button>

      {previewLegacy ? (
        <div className="border-border bg-surface-muted flex flex-col gap-1 rounded-xl border p-4 text-sm">
          <p className="font-semibold">
            عدد السجلات القابلة للتصدير: {previewLegacy.recordCount}
          </p>
          <p>إصدار المخطط: {previewLegacy.schemaVersion}</p>
          {previewLegacy.recordCount === 0 ? (
            <p className="text-danger">
              لا توجد سجلات مطابقة للتصدير حاليًا.{" "}
              {previewLegacy.totalApprovedCount === 0
                ? "لا توجد أي كلمة معتمدة بعد في قاعدة البيانات."
                : hasFilters
                  ? `الفلاتر الحالية استبعدت كل الكلمات الـ${previewLegacy.totalApprovedCount} المعتمدة — جرّب مسح الفلاتر.`
                  : "راجع سجل المراجعة."}
            </p>
          ) : null}
          <p className="text-foreground/70">
            إجمالي الكلمات المعتمدة (بلا فلاتر):{" "}
            {previewLegacy.totalApprovedCount}
          </p>
          {hasFilters ? (
            <p className="text-foreground/70">
              مستبعدة بسبب الفلاتر: {previewLegacy.excludedByFiltersCount}
            </p>
          ) : null}
          <p className="text-foreground/70">
            بلا مرادف فصيح (اختياري، لا يمنع التصدير):{" "}
            {previewLegacy.missingSynonymCount}
          </p>
          <p className="text-foreground/70">
            مصنّفة وبانتظار الاعتماد النهائي (غير مُصدَّرة بعد):{" "}
            {previewLegacy.awaitingApprovalCount}
          </p>
        </div>
      ) : null}

      {previewV4 ? (
        <div className="border-border bg-surface-muted flex flex-col gap-1 rounded-xl border p-4 text-sm">
          <p className="font-semibold">
            عدد السجلات القابلة للتصدير: {previewV4.recordCount}
          </p>
          {previewV4.recordCount === 0 ? (
            <p className="text-danger">
              لا توجد سجلات مطابقة للتصدير حاليًا — جرّب مسح الفلاتر أو راجع
              الكلمات المستبعدة أدناه.
            </p>
          ) : null}
          <p className="text-foreground/70">التوزيع حسب اللهجة الرئيسية:</p>
          <ul className="text-foreground/70 mr-4 list-disc">
            {Object.entries(previewV4.countsByMainDialect).map(
              ([code, count]) => (
                <li key={code}>
                  {MAIN_GROUP_LABELS_AR[code] ?? code}: {count}
                </li>
              ),
            )}
          </ul>
          <p className="text-foreground/70">
            بلا معنى مسجَّل: {previewV4.missingMeaningCount}
          </p>
          <p className="text-foreground/70">
            بلا مرادف فصيح: {previewV4.missingSynonymCount}
          </p>
          <p className="text-foreground/70">
            مستبعدة لعدم وجود مثال صالح: {previewV4.excludedInvalidExampleCount}
          </p>
          {previewV4.excludedEntries.length > 0 ? (
            <div className="border-border mt-2 rounded-lg border p-2">
              <p className="font-semibold">كلمات تحتاج مراجعة قبل التصدير:</p>
              <ul className="mr-4 list-disc">
                {previewV4.excludedEntries.map((e) => (
                  <li key={e.id}>{e.word} — بلا مثال صالح</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {status === "error" ? (
        <p role="alert" className="text-danger text-sm">
          تعذّر جلب المعاينة. قد تكون قاعدة البيانات غير متاحة مؤقتاً — حاول مرة
          أخرى.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => handleDownload("json")}>
          تنزيل JSON
        </Button>
        <Button type="button" onClick={() => handleDownload("jsonl")}>
          تنزيل JSONL
        </Button>
        {isV4 ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleDownload("allam")}
          >
            تنزيل ALLaM Training JSONL
          </Button>
        ) : null}
      </div>
    </div>
  );
}
