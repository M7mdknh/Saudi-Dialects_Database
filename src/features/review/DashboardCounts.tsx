import Link from "next/link";
import { STATUS_LABELS_AR } from "./status-labels";
import type { ReviewStatus } from "@/lib/supabase/types";

interface Counts {
  new: number;
  pending: number;
  approved: number;
  rejected: number;
  duplicate: number;
  merged: number;
  total: number;
  unseen: number;
  latest_export: {
    created_at: string;
    format: string;
    record_count: number;
  } | null;
}

export function DashboardCounts({ counts }: { counts: Counts }) {
  const statuses: ReviewStatus[] = [
    "new",
    "pending",
    "approved",
    "rejected",
    "duplicate",
    "merged",
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <div className="border-accent bg-accent/10 flex items-center gap-2 rounded-xl border px-4 py-3">
          <span className="text-sm font-medium">مساهمات جديدة لم تُفتح</span>
          <span
            className="bg-accent text-accent-foreground rounded-full px-2 py-0.5 text-sm font-bold"
            data-testid="unseen-badge"
          >
            {counts.unseen}
          </span>
        </div>
        {statuses.map((s) => (
          <Link
            key={s}
            href={`/admin?status=${s}`}
            className="border-border bg-surface hover:bg-surface-muted flex items-center gap-2 rounded-xl border px-4 py-3 text-sm"
          >
            <span>{STATUS_LABELS_AR[s]}</span>
            <span className="font-bold">{counts[s]}</span>
          </Link>
        ))}
      </div>
      <p className="text-foreground/60 text-xs">
        {counts.latest_export
          ? `آخر تصدير: ${new Date(counts.latest_export.created_at).toLocaleString("ar")} — ${counts.latest_export.record_count} سجل (${counts.latest_export.format})`
          : "لم يتم إجراء أي تصدير بعد."}
      </p>
    </div>
  );
}
