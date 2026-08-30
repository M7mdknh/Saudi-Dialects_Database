import { formatArabicCount } from "@/features/leaderboard/format";
import type {
  DuplicateCandidateType,
  DuplicateGroupStatus,
  MainDialectGroupCode,
} from "@/lib/supabase/types";

export const CANDIDATE_TYPE_LABELS_AR: Record<DuplicateCandidateType, string> =
  {
    exact: "تطابق مباشر",
    conflict: "تعارض في المعنى",
    fuzzy: "تشابه محتمل",
  };

export const RESOLUTION_STATUS_LABELS_AR: Record<DuplicateGroupStatus, string> =
  {
    unresolved: "غير محسوم",
    not_duplicate: "ليست مكررة",
    ignored: "تم تجاهله",
    merged: "تم الدمج",
    split: "تم الفصل إلى كلمات مستقلة",
  };

export const MAIN_GROUP_LABELS_AR: Record<MainDialectGroupCode, string> = {
  hijazi: "حجازي",
  najdi: "نجدي",
  eastern: "شرقاوي",
  northern: "شمالي",
  southern: "جنوبي",
};

export const SORT_LABELS_AR = {
  newest: "الأحدث",
  largest: "الأكبر عددًا",
  strongest: "الأقوى تطابقًا",
} as const;

/** "٣ مصادر" / "مصدران" / "مصدر واحد" — beside each detected dialect in the merge workspace. */
export function formatSourceCount(n: number): string {
  return formatArabicCount(n, "مصدر", "مصدران", "مصادر");
}

export const REGISTER_LABELS_AR: Record<string, string> = {
  neutral: "محايد",
  informal: "غير رسمي",
  slang: "عامي",
  offensive: "مسيء",
  taboo: "محظور",
  archaic: "قديم الاستخدام",
};
