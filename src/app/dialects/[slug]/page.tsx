import { notFound } from "next/navigation";
import Link from "next/link";
import { getDialectWords } from "@/features/explorer/actions";
import { DialectExplorer } from "@/features/explorer/DialectExplorer";
import type { MainDialectGroupCode } from "@/lib/supabase/types";

export const revalidate = 30;

const TITLES: Record<MainDialectGroupCode, string> = {
  hijazi: "كلمات مميزة من اللهجة الحجازية",
  najdi: "كلمات مميزة من اللهجة النجدية",
  eastern: "كلمات مميزة من اللهجة الشرقاوية",
  northern: "كلمات مميزة من اللهجة الشمالية",
  southern: "كلمات مميزة من اللهجة الجنوبية",
};

function isMainGroupCode(value: string): value is MainDialectGroupCode {
  return value in TITLES;
}

export default async function DialectExplorerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isMainGroupCode(slug)) notFound();

  const initial = await getDialectWords({
    mainGroupCode: slug,
    limit: 20,
    offset: 0,
  });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2 text-center">
        <Link
          href="/leaderboard"
          className="text-accent text-sm font-semibold hover:underline"
        >
          ← العودة إلى لوحة الصدارة
        </Link>
        <h1 className="text-foreground text-2xl font-bold">{TITLES[slug]}</h1>
        <p className="text-foreground/70">
          كلمات معتمدة فقط، مع أمثلتها ومرادفاتها الفصيحة.
        </p>
      </header>

      <DialectExplorer mainGroupCode={slug} initial={initial} />
    </main>
  );
}
