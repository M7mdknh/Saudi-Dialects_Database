"use client";

import Link from "next/link";
import type { LeaderboardEntry } from "./actions";
import {
  formatApprovedCount,
  formatParticipationCount,
  toArabicDigits,
} from "./format";
import {
  computeGapFromLeaderMessage,
  computeHeadlineMessage,
  computeStats,
  groupProgress,
  hasCompetitionStarted,
} from "./leaderboard-utils";

type Medal = "gold" | "silver" | "bronze" | "none";

function medalFor(rank: number, competing: boolean): Medal {
  if (!competing) return "none";
  if (rank === 1) return "gold";
  if (rank === 2) return "silver";
  if (rank === 3) return "bronze";
  return "none";
}

const MEDAL_BADGE_CLASSES: Record<Medal, string> = {
  gold: "bg-gold text-gold-foreground",
  silver: "bg-silver text-silver-foreground",
  bronze: "bg-bronze text-bronze-foreground",
  none: "bg-accent/10 text-accent",
};

const MEDAL_RING_CLASSES: Record<Medal, string> = {
  gold: "border-gold/60 ring-1 ring-gold/30",
  silver: "border-silver/50",
  bronze: "border-bronze/50",
  none: "border-border",
};

function ProgressBar({
  entry,
  entries,
}: {
  entry: LeaderboardEntry;
  entries: LeaderboardEntry[];
}) {
  const progress = groupProgress(entry, entries);
  const percent = Math.round(progress * 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`نسبة مساهمات ${entry.mainGroupLabelAr} مقارنة بالمتصدر`}
      className="bg-surface-muted h-2 w-full overflow-hidden rounded-full"
    >
      <div
        className="bg-accent h-full rounded-full transition-[width] duration-700"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function DeltaBadge({ delta }: { delta?: number }) {
  if (!delta || delta <= 0) return null;
  return (
    <span
      className="bg-accent text-accent-foreground animate-in fade-in absolute -end-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold shadow-sm"
      aria-hidden="true"
    >
      +{toArabicDigits(delta)}
    </span>
  );
}

interface CardActionsProps {
  entry: LeaderboardEntry;
  size: "large" | "regular" | "compact";
}

function CardActions({ entry, size }: CardActionsProps) {
  return (
    <div
      className={`flex items-center gap-3 ${size === "compact" ? "flex-row" : "flex-col sm:flex-row"}`}
    >
      <Link
        href={`/?dialect=${entry.mainGroupCode}#contribute`}
        className={`bg-accent text-accent-foreground flex min-h-9 items-center justify-center rounded-lg px-3 text-xs font-semibold hover:opacity-90 ${
          size === "large" ? "min-h-11 px-4 text-sm" : ""
        }`}
      >
        ساند لهجتك
      </Link>
      <Link
        href={`/dialects/${entry.mainGroupCode}`}
        className="text-foreground/70 hover:text-foreground flex min-h-9 items-center text-xs font-medium underline-offset-2 hover:underline"
      >
        استكشف الكلمات المعتمدة
      </Link>
    </div>
  );
}

function PodiumCard({
  entry,
  entries,
  dominant,
  recentDelta,
  className = "",
}: {
  entry: LeaderboardEntry;
  entries: LeaderboardEntry[];
  dominant: boolean;
  recentDelta?: number;
  className?: string;
}) {
  const competing = hasCompetitionStarted(entries);
  const medal = medalFor(entry.rank, competing);
  const gapMessage = computeGapFromLeaderMessage(entry, entries);

  return (
    <li
      className={`bg-surface-elevated relative flex flex-col items-center gap-3 rounded-2xl border p-4 text-center shadow-sm transition-colors duration-500 ${MEDAL_RING_CLASSES[medal]} ${
        dominant ? "gap-4 p-6" : ""
      } ${recentDelta ? "bg-accent/10" : ""} ${className}`}
    >
      <DeltaBadge delta={recentDelta} />
      <span
        className={`flex shrink-0 items-center justify-center rounded-full font-bold ${MEDAL_BADGE_CLASSES[medal]} ${
          dominant ? "h-12 w-12 text-xl" : "h-9 w-9 text-base"
        }`}
      >
        {toArabicDigits(entry.rank)}
      </span>
      <span
        className={`text-foreground font-bold ${dominant ? "text-xl" : "text-base"}`}
      >
        {entry.mainGroupLabelAr}
      </span>
      <p
        className={`text-foreground font-extrabold tabular-nums ${dominant ? "text-4xl" : "text-2xl"}`}
      >
        {formatParticipationCount(entry.submissionCount)}
      </p>
      <p className="text-foreground/60 text-sm">
        {formatApprovedCount(entry.approvedWordCount)}
      </p>
      <div className="w-full">
        <ProgressBar entry={entry} entries={entries} />
      </div>
      {gapMessage ? (
        <p className="text-foreground/60 text-xs">{gapMessage}</p>
      ) : null}
      <CardActions entry={entry} size={dominant ? "large" : "regular"} />
    </li>
  );
}

function CompactRow({
  entry,
  entries,
  recentDelta,
  className = "",
}: {
  entry: LeaderboardEntry;
  entries: LeaderboardEntry[];
  recentDelta?: number;
  className?: string;
}) {
  const competing = hasCompetitionStarted(entries);
  const medal = medalFor(entry.rank, competing);
  return (
    <li
      className={`bg-surface-elevated relative flex flex-col gap-2 rounded-xl border p-3 shadow-sm transition-colors duration-500 ${MEDAL_RING_CLASSES[medal]} ${recentDelta ? "bg-accent/10" : ""} ${className}`}
    >
      <DeltaBadge delta={recentDelta} />
      <div className="flex items-center gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${MEDAL_BADGE_CLASSES[medal]}`}
        >
          {toArabicDigits(entry.rank)}
        </span>
        <span className="text-foreground min-w-0 flex-1 truncate text-sm font-bold">
          {entry.mainGroupLabelAr}
        </span>
        <span className="text-foreground shrink-0 text-sm font-bold tabular-nums">
          {formatParticipationCount(entry.submissionCount)}
        </span>
      </div>
      <ProgressBar entry={entry} entries={entries} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-foreground/60 text-xs">
          {formatApprovedCount(entry.approvedWordCount)}
        </span>
        <CardActions entry={entry} size="compact" />
      </div>
    </li>
  );
}

export interface LeaderboardPodiumProps {
  entries: LeaderboardEntry[];
  variant: "compact" | "full";
  /** mainGroupCode -> submission count just added, from a completed refresh diff. */
  recentDeltas?: Record<string, number>;
}

export function LeaderboardPodium({
  entries,
  variant,
  recentDeltas = {},
}: LeaderboardPodiumProps) {
  if (entries.length === 0) {
    return (
      <p className="border-border bg-surface-muted text-foreground/60 rounded-xl border px-4 py-6 text-center text-sm">
        لا توجد بيانات لعرضها بعد.
      </p>
    );
  }

  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  const [first, second, third] = top3;
  const headline = computeHeadlineMessage(entries);
  const stats = computeStats(entries);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-foreground text-center text-base font-semibold">
        {headline}
      </p>

      {/*
        One list, reflowed by breakpoint via order/col-span rather than
        rendering two parallel DOM trees — duplicate markup toggled with
        "hidden lg:*" would double every name/count for screen readers and
        break single-match text queries.

        Mobile (grid-cols-2): leader spans both columns (row 1), 2nd/3rd
        sit side by side (row 2), 4th/5th each span both columns (rows 3-4).

        Desktop (lg:grid-cols-3): order-1/2/3 place 2nd/leader/3rd into
        grid columns 1/2/3 — under dir="rtl" that renders 2nd on the right,
        the leader centered, 3rd on the left. 4th/5th each span all three
        columns below.
      */}
      <ol className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:items-end lg:gap-5">
        {first ? (
          <PodiumCard
            entry={first}
            entries={entries}
            dominant
            recentDelta={recentDeltas[first.mainGroupCode]}
            className="order-1 col-span-2 lg:order-2 lg:col-span-1"
          />
        ) : null}
        {second ? (
          <PodiumCard
            entry={second}
            entries={entries}
            dominant={false}
            recentDelta={recentDeltas[second.mainGroupCode]}
            className="order-2 lg:order-1"
          />
        ) : null}
        {third ? (
          <PodiumCard
            entry={third}
            entries={entries}
            dominant={false}
            recentDelta={recentDeltas[third.mainGroupCode]}
            className="order-3"
          />
        ) : null}
        {rest.map((entry, i) => (
          <CompactRow
            key={entry.mainGroupCode}
            entry={entry}
            entries={entries}
            recentDelta={recentDeltas[entry.mainGroupCode]}
            className={`col-span-2 lg:col-span-3 ${i === 0 ? "order-4" : "order-5"}`}
          />
        ))}
      </ol>

      {variant === "full" ? (
        <dl className="border-border bg-surface-muted grid grid-cols-2 gap-4 rounded-2xl border p-4 text-center sm:grid-cols-4">
          <div>
            <dt className="text-foreground/60 text-xs">إجمالي المساهمات</dt>
            <dd className="text-foreground text-lg font-bold tabular-nums">
              {toArabicDigits(stats.totalSubmissions)}
            </dd>
          </div>
          <div>
            <dt className="text-foreground/60 text-xs">الكلمات المعتمدة</dt>
            <dd className="text-foreground text-lg font-bold tabular-nums">
              {toArabicDigits(stats.totalApproved)}
            </dd>
          </div>
          <div>
            <dt className="text-foreground/60 text-xs">فارق الصدارة</dt>
            <dd className="text-foreground text-lg font-bold tabular-nums">
              {stats.leaderGap === null ? "—" : toArabicDigits(stats.leaderGap)}
            </dd>
          </div>
          <div>
            <dt className="text-foreground/60 text-xs">عدد اللهجات المشاركة</dt>
            <dd className="text-foreground text-lg font-bold tabular-nums">
              {toArabicDigits(stats.participatingGroups)} / ٥
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
