"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LeaderboardPodium } from "./LeaderboardPodium";
import { getDialectLeaderboard, type LeaderboardEntry } from "./actions";
import { LEADERBOARD_REFRESH_EVENT } from "./refresh-event";
import { formatParticipationCount } from "./format";
import { Button } from "@/components/ui/Button";

interface LeaderboardSectionProps {
  /** null means the initial server-side load failed (a real error, not a genuine empty result). */
  initialEntries: LeaderboardEntry[] | null;
  variant: "compact" | "full";
}

const DELTA_DISPLAY_MS = 5000;

/**
 * Leaderboard shell shared by the homepage preview and the full
 * /leaderboard page: fetch/retry, and — on refresh — diffing the previous
 * snapshot against the new one to drive the "+N" celebration highlight and
 * an accessible live-region announcement. The diff approach (rather than
 * threading a payload through the refresh event) works no matter how many
 * submissions landed between refreshes and never needs the submitted word.
 */
export function LeaderboardSection({
  initialEntries,
  variant,
}: LeaderboardSectionProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [loading, setLoading] = useState(false);
  const [recentDeltas, setRecentDeltas] = useState<Record<string, number>>({});
  const [announcement, setAnnouncement] = useState("");
  const deltaTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const next = await getDialectLeaderboard();
      setEntries((prev) => {
        if (prev) {
          const deltas: Record<string, number> = {};
          for (const n of next) {
            const p = prev.find((e) => e.mainGroupCode === n.mainGroupCode);
            if (p && n.submissionCount > p.submissionCount) {
              deltas[n.mainGroupCode] = n.submissionCount - p.submissionCount;
            }
          }
          const changed = Object.entries(deltas);
          if (changed.length > 0) {
            setRecentDeltas(deltas);
            setAnnouncement(
              changed
                .map(([code, delta]) => {
                  const entry = next.find((e) => e.mainGroupCode === code);
                  const label = entry?.mainGroupLabelAr ?? code;
                  const rankNote =
                    entry && prev.find((e) => e.mainGroupCode === code)
                      ? (() => {
                          const prevRank = prev.find(
                            (e) => e.mainGroupCode === code,
                          )!.rank;
                          return entry.rank < prevRank
                            ? ` وتقدّمت إلى المركز ${entry.rank}`
                            : "";
                        })()
                      : "";
                  return `أُضيف ${formatParticipationCount(delta)} للهجة ${label}${rankNote}، رصيدها الآن ${formatParticipationCount(entry?.submissionCount ?? 0)}.`;
                })
                .join(" "),
            );
            if (deltaTimeout.current) clearTimeout(deltaTimeout.current);
            deltaTimeout.current = setTimeout(() => {
              setRecentDeltas({});
            }, DELTA_DISPLAY_MS);
          }
        }
        return next;
      });
    } catch {
      setEntries(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener(LEADERBOARD_REFRESH_EVENT, handler);
    return () => window.removeEventListener(LEADERBOARD_REFRESH_EVENT, handler);
  }, []);

  useEffect(() => {
    return () => {
      if (deltaTimeout.current) clearTimeout(deltaTimeout.current);
    };
  }, []);

  const heading =
    variant === "compact" ? "أي لهجة تتصدر قاموسنا؟" : "لوحة صدارة اللهجات";

  return (
    <section
      aria-labelledby="leaderboard-heading"
      className={`max-w-shell mx-auto flex w-full min-w-0 flex-col gap-5 px-4 sm:px-6 ${
        variant === "full" ? "py-4" : ""
      }`}
    >
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="flex flex-col gap-1 text-center">
        <h2
          id="leaderboard-heading"
          className={
            variant === "full"
              ? "text-foreground text-2xl font-bold sm:text-3xl"
              : "text-foreground text-xl font-bold"
          }
        >
          {heading}
        </h2>
        <p className="text-foreground/70 text-sm">
          كل كلمة ترسلها تضيف نقطة للهجتك، ولا تظهر الكلمات للعامة إلا بعد
          المراجعة.
        </p>
      </div>

      {entries === null ? (
        <div
          role="alert"
          className="border-border bg-surface-muted flex flex-col items-center gap-3 rounded-xl border px-4 py-6 text-center text-sm"
        >
          <p className="text-foreground/70">تعذّر تحميل لوحة الصدارة الآن.</p>
          <Button
            type="button"
            variant="secondary"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? "جارٍ إعادة المحاولة…" : "إعادة المحاولة"}
          </Button>
        </div>
      ) : (
        <LeaderboardPodium
          entries={entries}
          variant={variant}
          recentDeltas={recentDeltas}
        />
      )}

      {variant === "compact" ? (
        <div className="mx-auto flex flex-wrap justify-center gap-3">
          <Link
            href="/#contribute"
            className="bg-accent text-accent-foreground flex min-h-11 items-center rounded-xl px-4 py-2.5 text-sm font-semibold hover:opacity-90"
          >
            ساهم وارفع ترتيب لهجتك
          </Link>
          <Link
            href="/leaderboard"
            className="border-border text-foreground hover:bg-surface-muted flex min-h-11 items-center rounded-xl border px-4 py-2.5 text-sm font-semibold"
          >
            عرض لوحة اللهجات
          </Link>
        </div>
      ) : (
        <div className="mx-auto flex flex-col items-center gap-2 pt-2 text-center">
          <p className="text-foreground/60 text-sm">
            تقدر تساهم بكلمة من لهجتك وترفع ترتيبها فورًا.
          </p>
          <Link
            href="/#contribute"
            className="bg-accent text-accent-foreground flex min-h-11 items-center rounded-xl px-4 py-2.5 text-sm font-semibold hover:opacity-90"
          >
            أضف نقطة للهجتك
          </Link>
        </div>
      )}
    </section>
  );
}
