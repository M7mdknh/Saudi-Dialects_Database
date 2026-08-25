"use client";

import type { GuidedPromptRecord } from "./types";

interface PromptCardProps {
  prompt: GuidedPromptRecord;
  answered: boolean;
  onChoose: (prompt: GuidedPromptRecord) => void;
  /** Homepage uses the horizontal-scroll-snap sizing; /prompts uses a plain grid item. */
  variant?: "rail" | "grid";
}

/**
 * Deliberately minimal: category chip, the formal word (dominant text), one
 * line of meaning, and an action cue. The full definition/usage question
 * only appears after selection, inside the guided WordCard (see
 * ContributionForm/WordCard — card.referencePromptSnapshot.scenarioAr).
 * The whole card is one button, not a button nested in a larger clickable
 * area, so it has one meaningful accessible name and one tab stop.
 */
export function PromptCard({
  prompt,
  answered,
  onChoose,
  variant = "grid",
}: PromptCardProps) {
  return (
    <li
      className={
        variant === "rail" ? "w-[78%] shrink-0 snap-start sm:w-auto" : ""
      }
    >
      <button
        type="button"
        onClick={() => onChoose(prompt)}
        aria-label={
          answered
            ? `${prompt.msaLemma} — ${prompt.categoryLabelAr}، تمت الإجابة عنها من قبل على هذا الجهاز`
            : `${prompt.msaLemma} — ${prompt.categoryLabelAr}`
        }
        className={`group hover:border-accent focus-visible:outline-accent flex h-full min-h-[136px] w-full flex-col items-start gap-2 rounded-2xl border p-4 text-start shadow-sm transition-[transform,border-color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98] ${
          answered
            ? "border-success/40 bg-success/5"
            : "border-border bg-surface"
        }`}
      >
        <div className="flex w-full items-center justify-between gap-2">
          <span className="bg-surface-muted text-foreground/60 inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium">
            {prompt.categoryLabelAr}
          </span>
          {answered ? (
            <span className="text-success inline-flex shrink-0 items-center gap-1 text-xs font-semibold">
              <svg
                width="14"
                height="14"
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 10.5L8 14.5L16 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              تمت الإجابة
            </span>
          ) : null}
        </div>
        <p className="text-foreground text-lg font-bold">{prompt.msaLemma}</p>
        <p className="text-foreground/70 line-clamp-1 text-sm">
          {prompt.definitionAr}
        </p>
        <span className="text-accent mt-auto inline-flex items-center gap-1 text-sm font-semibold">
          أضف كلمتك
          <span
            aria-hidden="true"
            className="transition-transform group-hover:-translate-x-0.5"
          >
            ←
          </span>
        </span>
      </button>
    </li>
  );
}
