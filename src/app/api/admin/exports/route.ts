import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  fetchApprovedEntries,
  getExportEligibilitySummary,
  getExportV4ValidationSummary,
  logExport,
} from "@/features/exports/export-service";
import {
  EXPORT_SCHEMA_VERSION,
  EXPORT_SCHEMA_VERSION_V2,
  EXPORT_SCHEMA_VERSION_V3,
  EXPORT_SCHEMA_VERSION_V4,
  MAIN_GROUP_ORDER,
  projectToExportV1,
  projectToExportV2,
  projectToExportV3,
  projectToExportV4,
} from "@/features/exports/projection";
import {
  computeChecksum,
  computeChecksumV2,
  computeChecksumV3,
  computeChecksumV4,
  generateAllamRows,
  serializeAllamJsonl,
  serializeJson,
  serializeJsonl,
  serializeJsonlV2,
  serializeJsonlV3,
  serializeJsonlV4,
  serializeJsonV2,
  serializeJsonV3,
  serializeJsonV4,
} from "@/features/exports/serializer";
import type { MainDialectGroupCode } from "@/lib/supabase/types";

const VALID_SCHEMA_VERSIONS = new Set(["1", "2", "3", "4"]);
const VALID_VISIBILITY_FILTERS = new Set(["all", "public", "private"]);
const VALID_MAIN_GROUP_CODES = new Set<string>(MAIN_GROUP_ORDER);

function parseFormat(url: URL): "json" | "jsonl" | "allam" {
  const raw = url.searchParams.get("format");
  if (raw === "allam") return "allam";
  if (raw === "jsonl") return "jsonl";
  return "json";
}

export async function GET(request: Request) {
  await requireAdmin();

  const url = new URL(request.url);
  const format = parseFormat(url);
  const preview = url.searchParams.get("preview") === "1";
  const dialectId = url.searchParams.get("dialectId") ?? undefined;
  const mainGroupCodeParam = url.searchParams.get("mainGroupCode") ?? "";
  if (mainGroupCodeParam && !VALID_MAIN_GROUP_CODES.has(mainGroupCodeParam)) {
    return NextResponse.json({ code: "INVALID_MAIN_GROUP" }, { status: 400 });
  }
  const updatedFrom = url.searchParams.get("updatedFrom") ?? undefined;
  const updatedTo = url.searchParams.get("updatedTo") ?? undefined;
  const visibilityParam = url.searchParams.get("visibility") ?? "all";
  if (!VALID_VISIBILITY_FILTERS.has(visibilityParam)) {
    return NextResponse.json({ code: "INVALID_VISIBILITY" }, { status: 400 });
  }

  // ALLaM training rows are always derived from the v4 clean projection,
  // regardless of what schemaVersion the caller passed.
  const schemaVersionParam =
    format === "allam" ? "4" : (url.searchParams.get("schemaVersion") ?? "1");
  if (!VALID_SCHEMA_VERSIONS.has(schemaVersionParam)) {
    return NextResponse.json(
      { code: "INVALID_SCHEMA_VERSION" },
      { status: 400 },
    );
  }

  // `mainGroupCode` is intentionally undefined (not "all"/empty-string) when
  // absent, so "all dialects" never silently reuses a value left over from a
  // previous request — each request's filters are built fresh from its own
  // query string only. See export.test.ts's stale-filter regression.
  const filters = {
    dialectId,
    mainGroupCode: mainGroupCodeParam
      ? (mainGroupCodeParam as MainDialectGroupCode)
      : undefined,
    updatedFrom,
    updatedTo,
    visibility: visibilityParam as "all" | "public" | "private",
  };

  if (preview) {
    try {
      if (schemaVersionParam === "4") {
        const summary = await getExportV4ValidationSummary(filters);
        return NextResponse.json({
          recordCount: summary.recordCount,
          schemaVersion: 4,
          countsByMainDialect: summary.countsByMainDialect,
          missingMeaningCount: summary.missingMeaningCount,
          missingSynonymCount: summary.missingSynonymCount,
          excludedInvalidExampleCount: summary.excludedInvalidExampleCount,
          excludedEntries: summary.excludedEntries,
        });
      }
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
  let logFormat: "json" | "jsonl" | "allam-jsonl" =
    format === "allam" ? "allam-jsonl" : format;
  let filename = `lahajat-export.${format}`;

  try {
    if (format === "allam") {
      const { records } = projectToExportV4(entries);
      const rows = generateAllamRows(records);
      recordCount = rows.length;
      schemaVersion = EXPORT_SCHEMA_VERSION_V4;
      body = serializeAllamJsonl(rows);
      checksum = computeChecksumV4(records);
      logFormat = "allam-jsonl";
      filename = "lahajat-allam-training.jsonl";
    } else if (schemaVersionParam === "4") {
      const { records } = projectToExportV4(entries);
      recordCount = records.length;
      schemaVersion = EXPORT_SCHEMA_VERSION_V4;
      checksum = computeChecksumV4(records);
      body =
        format === "jsonl"
          ? serializeJsonlV4(records)
          : serializeJsonV4(records);
    } else if (schemaVersionParam === "3") {
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
    format: logFormat,
    schemaVersion,
    filters,
    recordCount,
    checksum,
  });

  return new NextResponse(body, {
    headers: {
      "Content-Type":
        format === "json"
          ? "application/json; charset=utf-8"
          : "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
