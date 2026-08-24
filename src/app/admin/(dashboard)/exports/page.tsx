import { requireAdmin } from "@/lib/auth/require-admin";
import { listDialects } from "@/features/review/actions";
import { ExportPanel } from "@/features/exports/ExportPanel";

export default async function ExportsPage() {
  await requireAdmin();
  const dialects = await listDialects();
  return <ExportPanel dialects={dialects} />;
}
