/**
 * A successful submission and the homepage leaderboard preview live in
 * separate component subtrees (siblings under page.tsx), so a plain
 * `window` CustomEvent is the simplest way to tell the preview "refetch
 * now" without prop-drilling or a context provider just for this one
 * signal. No submitted content is ever included in the event.
 */
export const LEADERBOARD_REFRESH_EVENT = "lahajat:leaderboard-updated";

export function notifyLeaderboardUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LEADERBOARD_REFRESH_EVENT));
}
