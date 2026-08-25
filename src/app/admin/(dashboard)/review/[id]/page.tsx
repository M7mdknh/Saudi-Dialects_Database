import { requireAdmin } from "@/lib/auth/require-admin";
import { getSubmissionDetail, listDialects } from "@/features/review/actions";
import { ReviewDetail } from "@/features/review/ReviewDetail";

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const [{ submission, history, duplicates, canonicalStatus }, dialects] =
    await Promise.all([getSubmissionDetail(id), listDialects()]);

  return (
    <ReviewDetail
      submission={submission}
      history={history}
      duplicates={duplicates}
      dialects={dialects}
      canonicalStatus={canonicalStatus}
    />
  );
}
