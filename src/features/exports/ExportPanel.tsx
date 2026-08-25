"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

interface DialectOption {
  id: string;
  name_ar: string;
}

export function ExportPanel({ dialects }: { dialects: DialectOption[] }) {
  const [dialectId, setDialectId] = useState("");
  const [updatedFrom, setUpdatedFrom] = useState("");
  const [updatedTo, setUpdatedTo] = useState("");
  const [schemaVersion, setSchemaVersion] = useState<"1" | "2">("1");
  const [preview, setPreview] = useState<{
    recordCount: number;
    schemaVersion: number;
    checksum: string;
  } | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  function buildQuery(extra: Record<string, string>) {
    const params = new URLSearchParams();
    if (dialectId) params.set("dialectId", dialectId);
    if (updatedFrom)
      params.set("updatedFrom", new Date(updatedFrom).toISOString());
    if (updatedTo) params.set("updatedTo", new Date(updatedTo).toISOString());
    if (schemaVersion === "2") params.set("schemaVersion", "2");
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
    return params.toString();
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
      <Field id="export-dialect" label="اللهجة المعتمدة">
        <select
          id="export-dialect"
          value={dialectId}
          onChange={(e) => setDialectId(e.target.value)}
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
            onChange={(e) => setUpdatedFrom(e.target.value)}
            className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </Field>
        <Field id="updated-to" label="إلى تاريخ التحديث">
          <input
            id="updated-to"
            type="date"
            value={updatedTo}
            onChange={(e) => setUpdatedTo(e.target.value)}
            className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </Field>
      </div>

      <Field id="export-schema-version" label="إصدار مخطط التصدير">
        <select
          id="export-schema-version"
          value={schemaVersion}
          onChange={(e) => setSchemaVersion(e.target.value as "1" | "2")}
          className="border-border bg-surface min-h-11 w-full rounded-lg border px-3 py-2"
        >
          <option value="1">الإصدار ١ (الافتراضي والثابت)</option>
          <option value="2">
            الإصدار ٢ (يضيف تصنيف اللهجة الرئيسية والمفهوم المرجعي)
          </option>
        </select>
      </Field>

      <Button
        type="button"
        variant="secondary"
        disabled={status === "loading"}
        onClick={handlePreview}
      >
        معاينة عدد السجلات
      </Button>

      {preview ? (
        <div className="border-border bg-surface-muted rounded-xl border p-4 text-sm">
          <p>عدد السجلات: {preview.recordCount}</p>
          <p>إصدار المخطط: {preview.schemaVersion}</p>
          <p dir="ltr" className="break-all">
            checksum: {preview.checksum}
          </p>
        </div>
      ) : null}

      {status === "error" ? (
        <p className="text-danger text-sm">تعذّر جلب المعاينة.</p>
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
