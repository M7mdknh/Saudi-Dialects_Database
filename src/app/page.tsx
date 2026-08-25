import Link from "next/link";
import { ContributionForm } from "@/features/contributions/ContributionForm";
import { listReferencePromptsPage } from "@/features/prompts/actions";
import { GUIDED_PROMPT_BATCH_SIZE } from "@/features/prompts/constants";
import { listPublicDialects } from "@/features/contributions/dialects-actions";
import { getDialectLeaderboard } from "@/features/leaderboard/actions";
import { LeaderboardSection } from "@/features/leaderboard/LeaderboardSection";
import { getPublicEnv } from "@/lib/env";

export const revalidate = 0;

export default async function HomePage() {
  const { NEXT_PUBLIC_TURNSTILE_SITE_KEY } = getPublicEnv();

  // Each independent data source fails on its own: a broken leaderboard RPC
  // must not take down the guided-prompt rail or the form, and vice versa.
  // Genuine failures are distinguished from genuine-empty results (null vs
  // []) so the client renders a real retry state instead of a silent "no
  // suggestions" message (see GuidedPromptRail/LeaderboardSection).
  const [promptsResult, dialectsResult, leaderboardResult] =
    await Promise.allSettled([
      listReferencePromptsPage({ offset: 0, limit: GUIDED_PROMPT_BATCH_SIZE }),
      listPublicDialects(),
      getDialectLeaderboard(),
    ]);

  if (promptsResult.status === "rejected") {
    console.error("guided_prompts_initial_load_failed", {
      message: (promptsResult.reason as Error)?.message,
    });
  }
  if (dialectsResult.status === "rejected") {
    console.error("public_dialects_initial_load_failed", {
      message: (dialectsResult.reason as Error)?.message,
    });
  }

  const initialPrompts =
    promptsResult.status === "fulfilled" ? promptsResult.value : null;
  const initialDialectOptions =
    dialectsResult.status === "fulfilled" ? dialectsResult.value : [];
  const initialLeaderboard =
    leaderboardResult.status === "fulfilled" ? leaderboardResult.value : null;

  return (
    <div className="flex w-full flex-col gap-10 pb-12">
      <section className="max-w-shell mx-auto flex w-full flex-col items-center gap-4 px-4 pt-8 pb-2 text-center sm:px-6">
        <h1 className="text-foreground text-3xl font-bold sm:text-4xl">
          قاموس اللهجات السعودية
        </h1>
        <p className="text-foreground/70 max-w-reading text-base sm:text-lg">
          شاركنا كلمات منطقتك، وساهم في توثيق تنوّع لهجات المملكة.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <Link
            href="#contribute"
            className="bg-accent text-accent-foreground flex min-h-11 items-center rounded-xl px-5 py-2.5 text-sm font-semibold hover:opacity-90"
          >
            ساهم بكلمة
          </Link>
          <Link
            href="/prompts"
            className="border-border text-foreground hover:bg-surface-muted flex min-h-11 items-center rounded-xl border px-5 py-2.5 text-sm font-semibold"
          >
            استكشف تحدّي الكلمات
          </Link>
        </div>
      </section>

      <ContributionForm
        turnstileSiteKey={NEXT_PUBLIC_TURNSTILE_SITE_KEY}
        initialPrompts={initialPrompts}
        initialDialectOptions={initialDialectOptions}
      />
      <LeaderboardSection
        initialEntries={initialLeaderboard}
        variant="compact"
      />
    </div>
  );
}
