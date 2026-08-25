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

const SCHEMA_LABELS: Record<"1" | "2" | "3", string> = {
  "1": "الإصدار ١ (الافتراضي والثابت)",
  "2": "الإصدار ٢ (يضيف تصنيف اللهجة الرئيسية والمفهوم المرجعي)",
  "3": "الإصدار ٣ — قاموس اللهجات السعودية (موصى به)",
};

export function ExportPanel({ dialects }: { dialects: DialectOption[] }) {
  const [dialectId, setDialectId] = useState("");
  const [updatedFrom, setUpdatedFrom] = useState("");
  const [updatedTo, setUpdatedTo] = useState("");
  const [schemaVersion, setSchemaVersion] = useState<"1" | "2" | "3">("3");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  const hasFilters = Boolean(dialectId || updatedFrom || updatedTo);

  function buildQuery(extra: Record<string, string>) {
    const params = new URLSearchParams();
    if (dialectId) params.set("dialectId", dialectId);
    if (updatedFrom)
      params.set("updatedFrom", new Date(updatedFrom).toISOString());
    if (updatedTo) params.set("updatedTo", new Date(updatedTo).toISOString());
    params.set("schemaVersion", schemaVersion);
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
    return params.toString();
  }

  function clearFilters() {
    setDialectId("");
    setUpdatedFrom("");
    setUpdatedTo("");
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

  function handleDownload(format: "json" | "jsonl") {
    // File download from our own API route (Content-Disposition: attachment),
    // not an internal page navigation, so this intentionally bypasses the
    // Next.js router.
    window.open(`/api/admin/exports?${buildQuery({ format })}`, "_blank");
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <h1 className="text-xl font-bold">تصدير البيانات</h1>

      <Field id="export-schema-version" label="إصدار مخطط التصدير">
        <select
          id="export-schema-version"
          value={schemaVersion}
          onChange={(e) => {
            setSchemaVersion(e.target.value as "1" | "2" | "3");
            setPreview(null);
          }}
          className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
        >
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

      {preview ? (
        <div className="border-border bg-surface-muted flex flex-col gap-1 rounded-xl border p-4 text-sm">
          <p className="font-semibold">
            عدد السجلات القابلة للتصدير: {preview.recordCount}
          </p>
          <p>إصدار المخطط: {preview.schemaVersion}</p>
          {preview.recordCount === 0 ? (
            <p className="text-danger">
              لا توجد سجلات مطابقة للتصدير حاليًا.{" "}
              {preview.totalApprovedCount === 0
                ? "لا توجد أي كلمة معتمدة بعد في قاعدة البيانات."
                : hasFilters
                  ? `الفلاتر الحالية استبعدت كل الكلمات الـ${preview.totalApprovedCount} المعتمدة — جرّب مسح الفلاتر.`
                  : "راجع سجل المراجعة."}
            </p>
          ) : null}
          <p className="text-foreground/70">
            إجمالي الكلمات المعتمدة (بلا فلاتر): {preview.totalApprovedCount}
          </p>
          {hasFilters ? (
            <p className="text-foreground/70">
              مستبعدة بسبب الفلاتر: {preview.excludedByFiltersCount}
            </p>
          ) : null}
          <p className="text-foreground/70">
            بلا مرادف فصيح (اختياري، لا يمنع التصدير):{" "}
            {preview.missingSynonymCount}
          </p>
          <p className="text-foreground/70">
            مصنّفة وبانتظار الاعتماد النهائي (غير مُصدَّرة بعد):{" "}
            {preview.awaitingApprovalCount}
          </p>
        </div>
      ) : null}

      {status === "error" ? (
        <p role="alert" className="text-danger text-sm">
          تعذّر جلب المعاينة. قد تكون قاعدة البيانات غير متاحة مؤقتاً — حاول مرة
          أخرى.
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="button" onClick={() => handleDownload("json")}>
          تنزيل JSON
        </Button>
        <Button type="button" onClick={() => handleDownload("jsonl")}>
          تنزيل JSONL
        </Button>
      </div>
    </div>
  );
}
