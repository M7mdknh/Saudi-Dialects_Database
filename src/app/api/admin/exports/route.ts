import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  fetchApprovedEntries,
  logExport,
} from "@/features/exports/export-service";
import {
  EXPORT_SCHEMA_VERSION,
  EXPORT_SCHEMA_VERSION_V2,
  projectToExportV1,
  projectToExportV2,
} from "@/features/exports/projection";
import {
  computeChecksum,
  computeChecksumV2,
  serializeJson,
  serializeJsonl,
  serializeJsonV2,
  serializeJsonlV2,
} from "@/features/exports/serializer";

export async function GET(request: Request) {
  await requireAdmin();

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "jsonl" ? "jsonl" : "json";
  const preview = url.searchParams.get("preview") === "1";
  const dialectId = url.searchParams.get("dialectId") ?? undefined;
  const updatedFrom = url.searchParams.get("updatedFrom") ?? undefined;
  const updatedTo = url.searchParams.get("updatedTo") ?? undefined;
  // v1 remains the default, unchanged contract. v2 is opt-in and additive
  // (see projection.ts) — pass ?schemaVersion=2 to include it.
  const useV2 = url.searchParams.get("schemaVersion") === "2";

  const entries = await fetchApprovedEntries({
    dialectId,
    updatedFrom,
    updatedTo,
  });
  const exportedAt = new Date().toISOString();

  let recordCount: number;
  let schemaVersion: number;
  let checksum: string;
  let body: string;

  if (useV2) {
    const records = projectToExportV2(entries);
    recordCount = records.length;
    schemaVersion = EXPORT_SCHEMA_VERSION_V2;
    checksum = computeChecksumV2(records);
    body =
      format === "jsonl"
        ? serializeJsonlV2(records)
        : serializeJsonV2(records, exportedAt);
  } else {
    const records = projectToExportV1(entries);
    recordCount = records.length;
    schemaVersion = EXPORT_SCHEMA_VERSION;
    checksum = computeChecksum(records);
    body =
      format === "jsonl"
        ? serializeJsonl(records)
        : serializeJson(records, exportedAt);
  }

  if (preview) {
    return NextResponse.json({ recordCount, schemaVersion, checksum });
  }

  await logExport({
    format,
    schemaVersion,
    filters: { dialectId, updatedFrom, updatedTo },
    recordCount,
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
