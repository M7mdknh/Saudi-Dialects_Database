import { toSearchKey } from "@/lib/text/normalize-arabic";
import type { MainDialectGroupCode } from "@/lib/supabase/types";

/**
 * Pure planning logic for the fast bulk-approval flow. Each submission
 * already carries enough information to classify itself — the contribution
 * form always sets exactly one of:
 *
 *   - selectedDialectId: a trusted, existing dialect row the contributor
 *     picked from the combobox (this covers BOTH "picked a local dialect"
 *     like مديني and "picked a main group directly" like حجازي — both are
 *     real `dialects` rows with `main_group_code` already set; a main-group
 *     row simply has `parentId === null`). The FK *is* the classification;
 *     no text matching is needed or correct here.
 *   - provisionalMainGroupCode (with selectedDialectId null): the
 *     contributor typed a custom local label and picked their best-guess
 *     main group for it. The admin's quick-approval confirms that proposal
 *     by reusing a matching existing dialect under that group, or creating
 *     one.
 *   - neither: a legacy/incomplete submission with no classification signal
 *     at all — genuinely needs manual review.
 *
 * There is deliberately no "batch main group" input: a selected batch may
 * span every group at once, and each row resolves independently. Kept
 * separate from review/actions.ts so the decision rules are unit-testable
 * without a live Supabase instance.
 */

export interface BulkApprovalSourceRow {
  submissionId: string;
  submittedDialect: string;
  selectedDialectId: string | null;
  provisionalMainGroupCode: MainDialectGroupCode | null;
}

export interface DialectTaxonomyRow {
  id: string;
  nameAr: string;
  parentId: string | null;
  mainGroupCode: MainDialectGroupCode | null;
  isActive: boolean;
}

export type NeedsAttentionReason =
  | "empty_label"
  | "group_conflict"
  | "ambiguous"
  | "invalid_trusted_dialect"
  | "missing_classification";

export type RowPlan =
  | {
      submissionId: string;
      kind: "trusted_local";
      dialectId: string;
      mainGroupCode: MainDialectGroupCode;
      label: string;
    }
  | {
      submissionId: string;
      kind: "main_group";
      dialectId: string;
      mainGroupCode: MainDialectGroupCode;
      label: string;
    }
  | {
      submissionId: string;
      kind: "create_local";
      key: string;
      mainGroupCode: MainDialectGroupCode;
      label: string;
    }
  | {
      submissionId: string;
      kind: "needs_attention";
      reason: NeedsAttentionReason;
      label: string;
    };

export interface NewDialectProposal {
  /** Composite key (mainGroupCode + search key) — the same local label text could legitimately be proposed under two different groups in one mixed batch. */
  key: string;
  label: string;
  slug: string;
  mainGroupCode: MainDialectGroupCode;
}

export interface BulkApprovalPlan {
  rowPlans: RowPlan[];
  /** Distinct new local-dialect proposals to create once, before resolving "create_local" rows to real ids. */
  newDialects: NewDialectProposal[];
}

/** Same derivation as review/actions.ts's createDialect() slug, applied only for planning (never persisted directly — create_dialect() still does the actual insert). */
function slugFor(label: string): string {
  return toSearchKey(label).replace(/\s+/g, "-");
}

export function planBulkApproval(
  rows: BulkApprovalSourceRow[],
  dialects: DialectTaxonomyRow[],
): BulkApprovalPlan {
  const active = dialects.filter((d) => d.isActive);
  const byId = new Map(active.map((d) => [d.id, d]));

  const mainGroupDialectByCode = new Map<
    MainDialectGroupCode,
    DialectTaxonomyRow
  >();
  for (const d of active) {
    if (d.parentId === null && d.mainGroupCode) {
      mainGroupDialectByCode.set(d.mainGroupCode, d);
    }
  }

  const byKey = new Map<string, DialectTaxonomyRow[]>();
  for (const d of active) {
    const key = toSearchKey(d.nameAr);
    const list = byKey.get(key) ?? [];
    list.push(d);
    byKey.set(key, list);
  }

  const newDialectsByKey = new Map<string, NewDialectProposal>();
  const rowPlans: RowPlan[] = [];

  for (const row of rows) {
    // Rules 1 & 2: a trusted selected dialect — reused verbatim, whether it
    // is a local dialect (مديني) or a main-group row itself (حجازي). No
    // text matching, no group re-selection: the FK already is the answer.
    if (row.selectedDialectId) {
      const d = byId.get(row.selectedDialectId);
      if (d && d.mainGroupCode) {
        rowPlans.push({
          submissionId: row.submissionId,
          kind: d.parentId === null ? "main_group" : "trusted_local",
          dialectId: d.id,
          mainGroupCode: d.mainGroupCode,
          label: d.nameAr,
        });
        continue;
      }
      rowPlans.push({
        submissionId: row.submissionId,
        kind: "needs_attention",
        reason: "invalid_trusted_dialect",
        label: row.submittedDialect,
      });
      continue;
    }

    // Rule 3: custom local label with the contributor's own provisional group.
    if (row.provisionalMainGroupCode) {
      const group = row.provisionalMainGroupCode;
      const label = row.submittedDialect.trim();
      if (!label) {
        rowPlans.push({
          submissionId: row.submissionId,
          kind: "needs_attention",
          reason: "empty_label",
          label,
        });
        continue;
      }

      const key = toSearchKey(label);
      const mainGroupDialect = mainGroupDialectByCode.get(group);

      if (mainGroupDialect && toSearchKey(mainGroupDialect.nameAr) === key) {
        rowPlans.push({
          submissionId: row.submissionId,
          kind: "main_group",
          dialectId: mainGroupDialect.id,
          mainGroupCode: group,
          label,
        });
        continue;
      }

      const matches = byKey.get(key) ?? [];
      const inGroup = matches.filter((d) => d.mainGroupCode === group);
      const outOfGroup = matches.filter((d) => d.mainGroupCode !== group);

      if (inGroup.length === 1) {
        rowPlans.push({
          submissionId: row.submissionId,
          kind: "trusted_local",
          dialectId: inGroup[0].id,
          mainGroupCode: group,
          label,
        });
        continue;
      }

      if (inGroup.length > 1) {
        rowPlans.push({
          submissionId: row.submissionId,
          kind: "needs_attention",
          reason: "ambiguous",
          label,
        });
        continue;
      }

      if (outOfGroup.length > 0) {
        rowPlans.push({
          submissionId: row.submissionId,
          kind: "needs_attention",
          reason: "group_conflict",
          label,
        });
        continue;
      }

      // No existing dialect anywhere matches — propose creating one under
      // the contributor's own provisional group, preserving exact spelling.
      const dialectKey = `${group}::${key}`;
      if (!newDialectsByKey.has(dialectKey)) {
        newDialectsByKey.set(dialectKey, {
          key: dialectKey,
          label,
          slug: slugFor(label),
          mainGroupCode: group,
        });
      }
      rowPlans.push({
        submissionId: row.submissionId,
        kind: "create_local",
        key: dialectKey,
        mainGroupCode: group,
        label,
      });
      continue;
    }

    // Rule 4: no classification signal at all — genuinely needs manual review.
    rowPlans.push({
      submissionId: row.submissionId,
      kind: "needs_attention",
      reason: "missing_classification",
      label: row.submittedDialect,
    });
  }

  return { rowPlans, newDialects: [...newDialectsByKey.values()] };
}

export interface BulkApprovalReadiness {
  total: number;
  ready: number;
  needsAttention: number;
}

/** "جاهزة للاعتماد: 4 — تحتاج مراجعة: 1" style readiness split, computed purely from the plan — the button-enable check and the compact preview share this one source of truth. */
export function computeReadiness(
  plan: BulkApprovalPlan,
): BulkApprovalReadiness {
  const needsAttention = plan.rowPlans.filter(
    (r) => r.kind === "needs_attention",
  ).length;
  return {
    total: plan.rowPlans.length,
    ready: plan.rowPlans.length - needsAttention,
    needsAttention,
  };
}

export interface BulkApprovalPreview extends BulkApprovalReadiness {
  reusingExisting: number;
  creatingNew: number;
  mainGroupOnly: number;
}

export function summarizeBulkApprovalPlan(
  plan: BulkApprovalPlan,
): BulkApprovalPreview {
  let reusingExisting = 0;
  let creatingNew = 0;
  let mainGroupOnly = 0;
  for (const row of plan.rowPlans) {
    if (row.kind === "trusted_local") reusingExisting += 1;
    else if (row.kind === "create_local") creatingNew += 1;
    else if (row.kind === "main_group") mainGroupOnly += 1;
  }
  const readiness = computeReadiness(plan);
  return { ...readiness, reusingExisting, creatingNew, mainGroupOnly };
}

/** "جاهزة للاعتماد: 4" / "تحتاج مراجعة: 1" — the compact pre-action preview line. */
export function formatReadinessSummary(
  readiness: BulkApprovalReadiness,
): string {
  const parts = [`جاهزة للاعتماد: ${readiness.ready}`];
  if (readiness.needsAttention > 0) {
    parts.push(`تحتاج مراجعة: ${readiness.needsAttention}`);
  }
  return parts.join(" — ");
}

/** "كلمة" object-position agreement (verbal-noun mudaf-ilayh: dual takes ـين, not ـان). */
function approvedCountPhrase(n: number): string {
  if (n === 1) return "كلمة واحدة";
  if (n === 2) return "كلمتين";
  if (n >= 3 && n <= 10) return `${n} كلمات`;
  return `${n} كلمة`;
}

/** "كلمة" subject-position agreement ("تحتاج كلمتان..." — the two words are the grammatical subject of تحتاج). */
function needsAttentionCountPhrase(n: number): string {
  if (n === 1) return "كلمة واحدة";
  if (n === 2) return "كلمتان";
  if (n >= 3 && n <= 10) return `${n} كلمات`;
  return `${n} كلمة`;
}

/** Arabic result summary — "تم اعتماد 12 كلمة. تحتاج كلمتان إلى مراجعة اللهجة." */
export function formatBulkApprovalResultMessage(params: {
  approvedCount: number;
  needsAttentionCount: number;
}): string {
  const { approvedCount, needsAttentionCount } = params;
  const approvedPart = `تم اعتماد ${approvedCountPhrase(approvedCount)}.`;
  if (needsAttentionCount === 0) return approvedPart;
  const attentionPart = `تحتاج ${needsAttentionCountPhrase(needsAttentionCount)} إلى مراجعة اللهجة.`;
  return `${approvedPart} ${attentionPart}`;
}
