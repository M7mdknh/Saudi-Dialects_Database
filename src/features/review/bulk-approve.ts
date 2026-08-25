import { toSearchKey } from "@/lib/text/normalize-arabic";
import type { MainDialectGroupCode } from "@/lib/supabase/types";

/**
 * Pure planning logic for the fast bulk-approval flow: given an
 * admin-selected main group and the contributors' own submitted-dialect
 * text, decide per row whether to reuse an existing local dialect, use the
 * main group itself, propose creating a new local dialect, or flag the row
 * for manual attention — without ever touching the database. Kept separate
 * from review/actions.ts so the decision rules are unit-testable without a
 * live Supabase instance.
 */

export interface BulkApprovalSourceRow {
  submissionId: string;
  submittedDialect: string;
}

export interface DialectTaxonomyRow {
  id: string;
  nameAr: string;
  parentId: string | null;
  mainGroupCode: MainDialectGroupCode | null;
  isActive: boolean;
}

export type RowPlan =
  | {
      submissionId: string;
      kind: "main_group";
      dialectId: string;
      label: string;
    }
  | { submissionId: string; kind: "reuse"; dialectId: string; label: string }
  | { submissionId: string; kind: "create"; key: string; label: string }
  | {
      submissionId: string;
      kind: "needs_attention";
      reason: "empty_label" | "group_conflict" | "ambiguous";
      label: string;
    };

export interface NewDialectProposal {
  key: string;
  label: string;
  slug: string;
}

export interface BulkApprovalPlan {
  mainGroupCode: MainDialectGroupCode;
  rowPlans: RowPlan[];
  /** Distinct new local-dialect labels to create once, before resolving "create" rows to real ids. */
  newDialects: NewDialectProposal[];
}

/** Same derivation as review/actions.ts's createDialect() slug, applied client/server-side only for planning (never persisted directly — create_dialect() still does the actual insert). */
function slugFor(label: string): string {
  return toSearchKey(label).replace(/\s+/g, "-");
}

export function planBulkApproval(
  rows: BulkApprovalSourceRow[],
  mainGroupCode: MainDialectGroupCode,
  dialects: DialectTaxonomyRow[],
): BulkApprovalPlan {
  const active = dialects.filter((d) => d.isActive);
  const mainGroupDialect = active.find(
    (d) => d.mainGroupCode === mainGroupCode && d.parentId === null,
  );

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

    if (mainGroupDialect && toSearchKey(mainGroupDialect.nameAr) === key) {
      rowPlans.push({
        submissionId: row.submissionId,
        kind: "main_group",
        dialectId: mainGroupDialect.id,
        label,
      });
      continue;
    }

    const matches = byKey.get(key) ?? [];
    const inGroup = matches.filter((d) => d.mainGroupCode === mainGroupCode);
    const outOfGroup = matches.filter((d) => d.mainGroupCode !== mainGroupCode);

    if (inGroup.length === 1) {
      rowPlans.push({
        submissionId: row.submissionId,
        kind: "reuse",
        dialectId: inGroup[0].id,
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

    // No existing dialect anywhere matches — propose creating one under the
    // selected main group, preserving the contributor's exact spelling.
    if (!newDialectsByKey.has(key)) {
      newDialectsByKey.set(key, { key, label, slug: slugFor(label) });
    }
    rowPlans.push({
      submissionId: row.submissionId,
      kind: "create",
      key,
      label,
    });
  }

  return {
    mainGroupCode,
    rowPlans,
    newDialects: [...newDialectsByKey.values()],
  };
}

export interface BulkApprovalPreview {
  total: number;
  reusingExisting: number;
  creatingNew: number;
  mainGroupOnly: number;
  needsAttention: number;
}

export function summarizeBulkApprovalPlan(
  plan: BulkApprovalPlan,
): BulkApprovalPreview {
  let reusingExisting = 0;
  let creatingNew = 0;
  let mainGroupOnly = 0;
  let needsAttention = 0;
  for (const row of plan.rowPlans) {
    if (row.kind === "reuse") reusingExisting += 1;
    else if (row.kind === "create") creatingNew += 1;
    else if (row.kind === "main_group") mainGroupOnly += 1;
    else needsAttention += 1;
  }
  return {
    total: plan.rowPlans.length,
    reusingExisting,
    creatingNew,
    mainGroupOnly,
    needsAttention,
  };
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
