import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  fetchApprovedEntries,
  logExport,
} from "@/features/exports/export-service";
import {
  EXPORT_SCHEMA_VERSION,
  projectToExportV1,
} from "@/features/exports/projection";
import {
  computeChecksum,
  serializeJson,
  serializeJsonl,
} from "@/features/exports/serializer";

export async function GET(request: Request) {
  await requireAdmin();

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "jsonl" ? "jsonl" : "json";
  const preview = url.searchParams.get("preview") === "1";
  const dialectId = url.searchParams.get("dialectId") ?? undefined;
  const updatedFrom = url.searchParams.get("updatedFrom") ?? undefined;
  const updatedTo = url.searchParams.get("updatedTo") ?? undefined;

  const entries = await fetchApprovedEntries({
    dialectId,
    updatedFrom,
    updatedTo,
  });
  const records = projectToExportV1(entries);
  const checksum = computeChecksum(records);

  if (preview) {
    return NextResponse.json({
      recordCount: records.length,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      checksum,
    });
  }

  const exportedAt = new Date().toISOString();
  const body =
    format === "jsonl"
      ? serializeJsonl(records)
      : serializeJson(records, exportedAt);

  await logExport({
    format,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    filters: { dialectId, updatedFrom, updatedTo },
    recordCount: records.length,
    checksum,
  });

  return new NextResponse(body, {
    headers: {
      "Content-Type":
        format === "jsonl"
          ? "application/x-ndjson; charset=utf-8"
          : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="lahajat-export.${format}"`,
    },
  });
}
