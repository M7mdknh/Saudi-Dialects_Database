import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  fetchApprovedEntries,
  getExportEligibilitySummary,
  logExport,
} from "@/features/exports/export-service";
import {
  EXPORT_SCHEMA_VERSION,
  EXPORT_SCHEMA_VERSION_V2,
  EXPORT_SCHEMA_VERSION_V3,
  projectToExportV1,
  projectToExportV2,
  projectToExportV3,
} from "@/features/exports/projection";
import {
  computeChecksum,
  computeChecksumV2,
  computeChecksumV3,
  serializeJson,
  serializeJsonl,
  serializeJsonlV2,
  serializeJsonlV3,
  serializeJsonV2,
  serializeJsonV3,
} from "@/features/exports/serializer";

const VALID_SCHEMA_VERSIONS = new Set(["1", "2", "3"]);

export async function GET(request: Request) {
  await requireAdmin();

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "jsonl" ? "jsonl" : "json";
  const preview = url.searchParams.get("preview") === "1";
  const dialectId = url.searchParams.get("dialectId") ?? undefined;
  const updatedFrom = url.searchParams.get("updatedFrom") ?? undefined;
  const updatedTo = url.searchParams.get("updatedTo") ?? undefined;

  const schemaVersionParam = url.searchParams.get("schemaVersion") ?? "1";
  if (!VALID_SCHEMA_VERSIONS.has(schemaVersionParam)) {
    return NextResponse.json(
      { code: "INVALID_SCHEMA_VERSION" },
      { status: 400 },
    );
  }

  const filters = { dialectId, updatedFrom, updatedTo };

  if (preview) {
    try {
      const summary = await getExportEligibilitySummary(filters);
      return NextResponse.json({
        recordCount: summary.eligibleCount,
        schemaVersion: Number(schemaVersionParam),
        totalApprovedCount: summary.totalApprovedCount,
        missingSynonymCount: summary.missingSynonymCount,
        awaitingApprovalCount: summary.awaitingApprovalCount,
        excludedByFiltersCount: summary.excludedByFiltersCount,
      });
    } catch (error) {
      console.error("export_preview_query_failed", {
        message: (error as Error).message,
      });
      return NextResponse.json({ code: "QUERY_FAILED" }, { status: 500 });
    }
  }

  let entries: Awaited<ReturnType<typeof fetchApprovedEntries>>;
  try {
    entries = await fetchApprovedEntries(filters);
  } catch (error) {
    // A real database failure must never be reported as a successful,
    // legitimately-empty export — that would be indistinguishable from
    // "no approved records exist" in the downloaded file.
    console.error("export_query_failed", {
      message: (error as Error).message,
    });
    return NextResponse.json({ code: "QUERY_FAILED" }, { status: 500 });
  }

  const exportedAt = new Date().toISOString();

  let recordCount: number;
  let schemaVersion: number;
  let checksum: string;
  let body: string;

  try {
    if (schemaVersionParam === "3") {
      const records = projectToExportV3(entries);
      recordCount = records.length;
      schemaVersion = EXPORT_SCHEMA_VERSION_V3;
      checksum = computeChecksumV3(records);
      body =
        format === "jsonl"
          ? serializeJsonlV3(records)
          : serializeJsonV3(records, exportedAt);
    } else if (schemaVersionParam === "2") {
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
  } catch (error) {
    console.error("export_projection_failed", {
      message: (error as Error).message,
    });
    return NextResponse.json({ code: "PROJECTION_FAILED" }, { status: 500 });
  }

  await logExport({
    format,
    schemaVersion,
    filters,
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
