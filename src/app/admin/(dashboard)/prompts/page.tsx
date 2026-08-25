import { requireAdmin } from "@/lib/auth/require-admin";
import {
  listPromptCategories,
  listReferencePrompts,
} from "@/features/prompts/actions";
import { PromptManagementGrid } from "@/features/prompts/PromptManagementGrid";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function AdminPromptsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;
  const status = params.status as "active" | "inactive" | undefined;

  const [{ rows, total, pageSize }, categories] = await Promise.all([
    listReferencePrompts({
      page,
      status,
      category: params.category,
      search: params.q,
    }),
    listPromptCategories(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-foreground text-xl font-bold">
          إدارة المعاني المقترحة
        </h1>
        <p className="text-foreground/60 text-sm">
          عدّل الصياغة أو فعّل/عطّل معنى مقترحًا. لا يمكن حذف معنى له مساهمات —
          عطّله بدلاً من ذلك.
        </p>
      </div>
      <PromptManagementGrid
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        search={params.q}
        category={params.category}
        status={status}
        categories={categories}
      />
    </div>
  );
}
