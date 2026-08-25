const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
export function toArabicDigits(n: number): string {
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

/**
 * Same agreement rules as formatParticipationCount, but with the genitive
 * dual form ("مساهمتين") required as a مضاف إليه after a preposition-like
 * head noun such as "بفارق" — as opposed to the nominative dual
 * ("مساهمتان") used when the count itself is the grammatical subject.
 */
export function formatParticipationCountGenitive(n: number): string {
  return formatArabicCount(n, "مساهمة", "مساهمتين", "مساهمات");
}

export function formatApprovedCount(n: number): string {
  return formatArabicCount(n, "كلمة معتمدة", "كلمتان معتمدتان", "كلمات معتمدة");
}
