import { ContributionForm } from "@/features/contributions/ContributionForm";
import { getGuidedPrompts } from "@/features/prompts/actions";
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
      getGuidedPrompts([]),
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
      <ContributionForm
        turnstileSiteKey={NEXT_PUBLIC_TURNSTILE_SITE_KEY}
        initialPrompts={initialPrompts}
        initialDialectOptions={initialDialectOptions}
      />
      <LeaderboardSection initialEntries={initialLeaderboard} />
    </div>
  );
}
