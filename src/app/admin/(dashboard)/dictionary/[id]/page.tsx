import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDictionaryEntryDetail } from "@/features/dictionary/actions";
import { listDialects } from "@/features/review/actions";
import { DictionaryEditor } from "@/features/dictionary/DictionaryEditor";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DictionaryEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const [entry, dialects] = await Promise.all([
    getDictionaryEntryDetail(id),
    listDialects(),
  ]);

  if (!entry) {
    notFound();
  }

  return <DictionaryEditor entry={entry} dialects={dialects} />;
}
