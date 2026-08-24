import type { ReviewStatus } from "@/lib/supabase/types";

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
