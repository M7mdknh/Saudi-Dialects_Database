import { requireAdmin } from "@/lib/auth/require-admin";
import { listDictionaryEntries } from "@/features/dictionary/actions";
import { listDialects } from "@/features/review/actions";
import { DictionaryTable } from "@/features/dictionary/DictionaryTable";

export default async function DictionaryPage() {
  await requireAdmin();

  const [{ rows, total }, dialects] = await Promise.all([
    listDictionaryEntries({}),
    listDialects(),
  ]);

  return (
    <DictionaryTable
      initialRows={rows}
      initialTotal={total}
      dialects={dialects}
    />
  );
}
