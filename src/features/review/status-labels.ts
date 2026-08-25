import type { PublicVisibility, ReviewStatus } from "@/lib/supabase/types";

export const STATUS_LABELS_AR: Record<ReviewStatus, string> = {
  new: "جديد",
  pending: "قيد المراجعة",
  approved: "معتمد",
  rejected: "مرفوض",
  duplicate: "مكرر",
  merged: "مدمج",
};

export const REVIEW_STATUS_FILTERS: ReviewStatus[] = [
  "new",
  "pending",
  "approved",
  "rejected",
  "duplicate",
  "merged",
];

export const VISIBILITY_LABELS_AR: Record<PublicVisibility, string> = {
  public: "عام",
  private: "خاص",
};

/** "معتمد — غير ظاهر للعامة": never a bare "معتمد" for an approved-private word, and never confusable with رفض/pending. */
export function approvedVisibilityBadgeLabel(
  visibility: PublicVisibility,
): string {
  return visibility === "public" ? "معتمد ومنشور" : "معتمد — غير ظاهر للعامة";
}

/** Compact grid-column variant of the same distinction. */
export const APPROVED_STATUS_FILTER_LABELS: Record<
  "approved_public" | "approved_private",
  string
> = {
  approved_public: "معتمد ومنشور",
  approved_private: "معتمد وغير منشور",
};
