import { requireAdmin } from "@/lib/auth/require-admin";
import {
  getAutoMergeableDuplicateCount,
  getDuplicateSummary,
  listDuplicateGroups,
} from "@/features/duplicates/actions";
import { DuplicateCenter } from "@/features/duplicates/DuplicateCenter";

export default async function DuplicatesPage() {
  await requireAdmin();

  const [summary, { rows, total }, autoMergeableCount] = await Promise.all([
    getDuplicateSummary(),
    listDuplicateGroups({ resolutionStatus: "unresolved" }),
    getAutoMergeableDuplicateCount(),
  ]);

  return (
    <DuplicateCenter
      initialRows={rows}
      initialTotal={total}
      initialSummary={summary}
      initialAutoMergeableCount={autoMergeableCount}
    />
  );
}
