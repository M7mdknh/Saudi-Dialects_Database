"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LeaderboardList } from "./LeaderboardList";
import { getDialectLeaderboard, type LeaderboardEntry } from "./actions";
import { LEADERBOARD_REFRESH_EVENT } from "./refresh-event";
import { Button } from "@/components/ui/Button";

interface LeaderboardSectionProps {
  /** null means the initial server-side load failed (a real error, not a genuine empty result). */
  initialEntries: LeaderboardEntry[] | null;
}

/**
 * Compact homepage leaderboard preview: always shows all five main Saudi
 * groups (the RPC itself never omits a zero-count group — see
 * public_dialect_leaderboard, migration 0013), with a link to the full
 * /leaderboard page. A failed fetch shows a distinct Arabic retry state
 * rather than silently disappearing.
 */
export function LeaderboardSection({
  initialEntries,
}: LeaderboardSectionProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const next = await getDialectLeaderboard();
      setEntries(next);
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

  return (
    <section
      aria-labelledby="leaderboard-preview-heading"
      className="max-w-shell mx-auto flex w-full min-w-0 flex-col gap-4 px-4 sm:px-6"
    >
      <div className="flex flex-col gap-1 text-center">
        <h2
          id="leaderboard-preview-heading"
          className="text-foreground text-lg font-bold"
        >
          أي لهجة جمعت مساهمات أكثر؟
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
        <LeaderboardList entries={entries} />
      )}

      <Link
        href="/leaderboard"
        className="bg-accent text-accent-foreground mx-auto min-h-11 w-fit rounded-xl px-4 py-2.5 text-sm font-semibold hover:opacity-90"
      >
        عرض لوحة اللهجات
      </Link>
    </section>
  );
}
