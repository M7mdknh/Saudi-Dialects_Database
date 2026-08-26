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
