import Link from "next/link";
import type { LeaderboardEntry } from "./actions";

const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
function toArabicDigits(n: number): string {
  return String(n)
    .split("")
    .map((d) => ARABIC_DIGITS[Number(d)] ?? d)
    .join("");
}

export function LeaderboardList({ entries }: { entries: LeaderboardEntry[] }) {
  const max = Math.max(1, ...entries.map((e) => e.approvedWordCount));

  if (entries.length === 0) {
    return (
      <p className="border-border bg-surface-muted text-foreground/60 rounded-xl border px-4 py-6 text-center text-sm">
        لا توجد كلمات معتمدة بعد. كن أول من يساهم!
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {entries.map((entry, index) => {
        const percent = Math.round((entry.approvedWordCount / max) * 100);
        const isLeader = index === 0 && entry.approvedWordCount > 0;
        return (
          <li
            key={entry.mainGroupCode}
            className={`bg-surface flex items-center gap-4 rounded-2xl border p-4 shadow-sm ${
              isLeader ? "border-gold/50" : "border-border"
            }`}
          >
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-bold ${
                isLeader
                  ? "bg-gold text-gold-foreground"
                  : "bg-accent/10 text-accent"
              }`}
              aria-hidden="true"
            >
              {toArabicDigits(index + 1)}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-foreground truncate text-base font-bold">
                  {entry.mainGroupLabelAr}
                </span>
                <span className="text-foreground/70 shrink-0 text-sm font-semibold">
                  {toArabicDigits(entry.approvedWordCount)} كلمة
                </span>
              </div>
              <div
                className="bg-surface-muted h-2 w-full overflow-hidden rounded-full"
                role="progressbar"
                aria-valuenow={entry.approvedWordCount}
                aria-valuemin={0}
                aria-valuemax={max}
                aria-label={`عدد الكلمات المعتمدة في اللهجة ${entry.mainGroupLabelAr}`}
              >
                <div
                  className="bg-accent h-full rounded-full"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
            <Link
              href={`/dialects/${entry.mainGroupCode}`}
              className="border-border text-foreground hover:bg-surface-muted shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold"
            >
              استكشف
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
