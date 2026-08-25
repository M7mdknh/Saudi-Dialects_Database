import Link from "next/link";
import { getDialectLeaderboard } from "@/features/leaderboard/actions";
import { LeaderboardList } from "@/features/leaderboard/LeaderboardList";

export const revalidate = 60;

export const metadata = {
  title: "لوحة الصدارة | لهجات",
};

export default async function LeaderboardPage() {
  const entries = await getDialectLeaderboard();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-foreground text-2xl font-bold">
          أي لهجة جمعت كلمات أكثر؟
        </h1>
        <p className="text-foreground/70">
          ترتيب اللهجات السعودية الخمس حسب عدد الكلمات المعتمدة والمميزة فقط.
        </p>
      </header>

      <LeaderboardList entries={entries} />

      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <p className="text-foreground/60 text-sm">
          تقدر تساهم بكلمة من لهجتك وترفع ترتيبها.
        </p>
        <Link
          href="/"
          className="bg-accent text-accent-foreground rounded-xl px-4 py-2.5 text-sm font-semibold hover:opacity-90"
        >
          ساهم بكلمة الآن
        </Link>
      </div>
    </main>
  );
}
