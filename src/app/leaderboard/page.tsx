import { getDialectLeaderboard } from "@/features/leaderboard/actions";
import { LeaderboardSection } from "@/features/leaderboard/LeaderboardSection";

// Always dynamic (matches the homepage's own leaderboard preview): the read
// goes through createSupabaseServerClient, which reads cookies(), so an ISR
// revalidate window would otherwise make Next attempt static prerendering
// first, hit Next's internal dynamic-API bailout, and log a misleading
// "failed" message before correctly falling back to dynamic rendering.
export const revalidate = 0;

export const metadata = {
  title: "لوحة صدارة اللهجات | لهجات",
};

export default async function LeaderboardPage() {
  // A real RPC failure must show a distinct Arabic retry state (see
  // LeaderboardSection), not a crashed page or a silently empty result.
  let initialEntries;
  try {
    initialEntries = await getDialectLeaderboard();
  } catch (error) {
    console.error("leaderboard_page_initial_load_failed", {
      message: (error as Error).message,
    });
    initialEntries = null;
  }

  return (
    <main className="max-w-shell mx-auto flex w-full flex-col gap-8 px-4 py-8 sm:px-6">
      <LeaderboardSection initialEntries={initialEntries} variant="full" />

      <p className="text-foreground/60 max-w-reading mx-auto text-center text-sm">
        يُحتسب رصيد كل لهجة من عدد المساهمات الموثوقة فور استلامها، بينما تظهر
        الكلمات في القاموس العام بعد اعتمادها من فريق المراجعة فقط.
      </p>
    </main>
  );
}
