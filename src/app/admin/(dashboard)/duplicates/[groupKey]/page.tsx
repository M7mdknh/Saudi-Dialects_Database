import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  getDuplicateGroupMembers,
  getDuplicateGroupRow,
} from "@/features/duplicates/actions";
import { listDialects } from "@/features/review/actions";
import { DuplicateMergeWorkspace } from "@/features/duplicates/DuplicateMergeWorkspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DuplicateGroupPage({
  params,
}: {
  params: Promise<{ groupKey: string }>;
}) {
  await requireAdmin();
  const { groupKey: rawGroupKey } = await params;
  const groupKey = decodeURIComponent(rawGroupKey);

  const [row, members, dialects] = await Promise.all([
    getDuplicateGroupRow(groupKey),
    getDuplicateGroupMembers(groupKey),
    listDialects(),
  ]);

  if (!row || members.length < 2) {
    notFound();
  }

  return (
    <DuplicateMergeWorkspace row={row} members={members} dialects={dialects} />
  );
}
