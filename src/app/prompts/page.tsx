import {
  listPromptCategoryCounts,
  listReferencePromptsPage,
} from "@/features/prompts/actions";
import { PromptsExplorer } from "@/features/prompts/PromptsExplorer";

export const revalidate = 0;

export const metadata = {
  title: "تحدّي الكلمات | قاموس اللهجات السعودية",
};

const PAGE_SIZE = 24;

export default async function PromptsPage() {
  const [initial, categories] = await Promise.all([
    listReferencePromptsPage({ offset: 0, limit: PAGE_SIZE }),
    listPromptCategoryCounts(),
  ]);

  return (
    <main className="max-w-shell mx-auto flex w-full flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-foreground text-2xl font-bold">تحدّي الكلمات</h1>
        <p className="text-foreground/70">
          اختر تصنيفًا، وشارك بالكلمات التي تستخدمونها في منطقتكم.
        </p>
      </header>

      <PromptsExplorer initial={initial} categories={categories} />
    </main>
  );
}
