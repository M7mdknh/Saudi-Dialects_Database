import { requireAdmin } from "@/lib/auth/require-admin";
import { getSubmissionsByIds, listDialects } from "@/features/review/actions";
import { MergeWorkspace } from "@/features/review/MergeWorkspace";

export default async function MergePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  await requireAdmin();
  const { ids } = await searchParams;
  const idList = (ids ?? "").split(",").filter(Boolean);
  const [submissions, dialects] = await Promise.all([
    getSubmissionsByIds(idList),
    listDialects(),
  ]);

  if (submissions.length < 2) {
    return (
      <p className="text-foreground/60 text-center">
        اختر سجلّين على الأقل لبدء الدمج.
      </p>
    );
  }

  return <MergeWorkspace submissions={submissions} dialects={dialects} />;
}
