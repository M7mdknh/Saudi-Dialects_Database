import { requireAdmin } from "@/lib/auth/require-admin";
import {
  getDashboardCounts,
  listDialects,
  listSubmissions,
} from "@/features/review/actions";
import { DashboardCounts } from "@/features/review/DashboardCounts";
import { ReviewGrid } from "@/features/review/ReviewGrid";
import type { PublicVisibility, ReviewStatus } from "@/lib/supabase/types";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function AdminDashboardPage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;
  const status = params.status as ReviewStatus | undefined;
  const visibility = params.visibility as PublicVisibility | undefined;
  const search = params.q;

  const [counts, { rows, total, pageSize }, dialects] = await Promise.all([
    getDashboardCounts(),
    listSubmissions({ page, status, visibility, search }),
    listDialects(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <DashboardCounts counts={counts} />
      <ReviewGrid
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        status={status}
        visibility={visibility}
        search={search}
        dialects={dialects}
      />
    </div>
  );
}
