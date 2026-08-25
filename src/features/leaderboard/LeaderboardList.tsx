"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { LeaderboardEntry } from "./actions";

const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
function toArabicDigits(n: number): string {
  return String(n)
    .split("")
    .map((d) => ARABIC_DIGITS[Number(d)] ?? d)
    .join("");
}

/**
 * Correct Arabic count agreement for a feminine noun (مساهمة/كلمة both
 * follow the same singular/dual/plural pattern). Zero uses the compact
 * digit+singular form ("٠ مساهمة"), matching how the count reads inline
 * next to a rank/label rather than as a standalone sentence.
 */
export function formatArabicCount(
  n: number,
  singular: string,
  dual: string,
  plural: string,
): string {
  if (n === 0) return `${toArabicDigits(0)} ${singular}`;
  if (n === 1) return `${singular} واحدة`;
  if (n === 2) return dual;
  if (n >= 3 && n <= 10) return `${toArabicDigits(n)} ${plural}`;
  return `${toArabicDigits(n)} ${singular}`;
}

export function formatParticipationCount(n: number): string {
  return formatArabicCount(n, "مساهمة", "مساهمتان", "مساهمات");
}

export function formatApprovedCount(n: number): string {
  return formatArabicCount(n, "كلمة معتمدة", "كلمتان معتمدتان", "كلمات معتمدة");
}

export function LeaderboardList({ entries }: { entries: LeaderboardEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="border-border bg-surface-muted text-foreground/60 rounded-xl border px-4 py-6 text-center text-sm">
        لا توجد مساهمات بعد. كن أول من يساهم!
      </p>
    );
  }

  return (
    <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {entries.map((entry) => (
        <LeaderboardRow key={entry.mainGroupCode} entry={entry} />
      ))}
    </ol>
  );
}

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  const isLeader = entry.rank === 1 && entry.submissionCount > 0;
  const [flash, setFlash] = useState(false);
  const previousCount = useRef(entry.submissionCount);

  useEffect(() => {
    if (previousCount.current === entry.submissionCount) return;
    previousCount.current = entry.submissionCount;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFlash(true);
    const timeout = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(timeout);
  }, [entry.submissionCount]);

  return (
    <li
      className={`bg-surface-elevated flex flex-col gap-2 rounded-2xl border p-4 shadow-sm transition-colors duration-500 ${
        isLeader ? "border-gold/50" : "border-border"
      } ${flash ? "bg-accent/10" : ""}`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-bold ${
            isLeader
              ? "bg-gold text-gold-foreground"
              : "bg-accent/10 text-accent"
          }`}
          aria-hidden="true"
        >
          {toArabicDigits(entry.rank)}
        </span>
        <span className="text-foreground min-w-0 flex-1 truncate text-base font-bold">
          {entry.mainGroupLabelAr}
        </span>
      </div>
      <p className="text-foreground text-lg font-bold" aria-live="polite">
        {formatParticipationCount(entry.submissionCount)}
      </p>
      <p className="text-foreground/60 text-sm">
        {formatApprovedCount(entry.approvedWordCount)}
      </p>
      <Link
        href={`/dialects/${entry.mainGroupCode}`}
        className="border-border text-foreground hover:bg-surface-muted flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm font-semibold"
      >
        استكشف الكلمات المعتمدة
      </Link>
    </li>
  );
}
