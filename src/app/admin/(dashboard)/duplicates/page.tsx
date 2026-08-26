import { requireAdmin } from "@/lib/auth/require-admin";
import {
  getDuplicateSummary,
  listDuplicateGroups,
} from "@/features/duplicates/actions";
import { DuplicateCenter } from "@/features/duplicates/DuplicateCenter";

export default async function DuplicatesPage() {
  await requireAdmin();

  const [summary, { rows, total }] = await Promise.all([
    getDuplicateSummary(),
    listDuplicateGroups({ resolutionStatus: "unresolved" }),
  ]);

  return (
    <DuplicateCenter
      initialRows={rows}
      initialTotal={total}
      initialSummary={summary}
    />
  );
}
