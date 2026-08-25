import { describe, expect, it } from "vitest";
import {
  formatBulkApprovalResultMessage,
  planBulkApproval,
  summarizeBulkApprovalPlan,
  type DialectTaxonomyRow,
} from "./bulk-approve";

const HIJAZI_MAIN: DialectTaxonomyRow = {
  id: "hijazi-main",
  nameAr: "حجازي",
  parentId: null,
  mainGroupCode: "hijazi",
  isActive: true,
};
const NAJDI_MAIN: DialectTaxonomyRow = {
  id: "najdi-main",
  nameAr: "نجدي",
  parentId: null,
  mainGroupCode: "najdi",
  isActive: true,
};
const MADANI: DialectTaxonomyRow = {
  id: "madani",
  nameAr: "مديني",
  parentId: "hijazi-main",
  mainGroupCode: "hijazi",
  isActive: true,
};
const QASSIMI: DialectTaxonomyRow = {
  id: "qassimi",
  nameAr: "قصيمي",
  parentId: "najdi-main",
  mainGroupCode: "najdi",
  isActive: true,
};

const DIALECTS = [HIJAZI_MAIN, NAJDI_MAIN, MADANI, QASSIMI];

describe("planBulkApproval — existing trusted local dialect", () => {
  it("reuses the existing canonical dialect record under the selected group", () => {
    const plan = planBulkApproval(
      [{ submissionId: "s1", submittedDialect: "مديني" }],
      "hijazi",
      DIALECTS,
    );
    expect(plan.rowPlans).toEqual([
      {
        submissionId: "s1",
        kind: "reuse",
        dialectId: "madani",
        label: "مديني",
      },
    ]);
    expect(plan.newDialects).toEqual([]);
  });
});

describe("planBulkApproval — main group submitted directly", () => {
  it("uses the main group itself, no local dialect required", () => {
    const plan = planBulkApproval(
      [{ submissionId: "s1", submittedDialect: "حجازي" }],
      "hijazi",
      DIALECTS,
    );
    expect(plan.rowPlans).toEqual([
      {
        submissionId: "s1",
        kind: "main_group",
        dialectId: "hijazi-main",
        label: "حجازي",
      },
    ]);
  });
});

describe("planBulkApproval — new valid local dialect", () => {
  it("proposes creating a new local dialect under the selected group, preserving exact spelling", () => {
    const plan = planBulkApproval(
      [{ submissionId: "s1", submittedDialect: "جداوي" }],
      "hijazi",
      DIALECTS,
    );
    expect(plan.rowPlans).toEqual([
      { submissionId: "s1", kind: "create", key: "جداوي", label: "جداوي" },
    ]);
    expect(plan.newDialects).toEqual([
      { key: "جداوي", label: "جداوي", slug: "جداوي" },
    ]);
  });

  it("creates only one proposal for the same new label reused across several rows in the batch", () => {
    const plan = planBulkApproval(
      [
        { submissionId: "s1", submittedDialect: "جداوي" },
        { submissionId: "s2", submittedDialect: "جداوي" },
      ],
      "hijazi",
      DIALECTS,
    );
    expect(plan.newDialects).toHaveLength(1);
    expect(plan.rowPlans.every((r) => r.kind === "create")).toBe(true);
  });
});

describe("planBulkApproval — conflict / ambiguity", () => {
  it("flags a submitted dialect that belongs to a different trusted main group", () => {
    const plan = planBulkApproval(
      [{ submissionId: "s1", submittedDialect: "قصيمي" }],
      "hijazi",
      DIALECTS,
    );
    expect(plan.rowPlans).toEqual([
      {
        submissionId: "s1",
        kind: "needs_attention",
        reason: "group_conflict",
        label: "قصيمي",
      },
    ]);
  });

  it("flags an ambiguous match against several dialects in the same group", () => {
    const dupInGroup: DialectTaxonomyRow = {
      id: "madani-2",
      nameAr: "مديني",
      parentId: "hijazi-main",
      mainGroupCode: "hijazi",
      isActive: true,
    };
    const plan = planBulkApproval(
      [{ submissionId: "s1", submittedDialect: "مديني" }],
      "hijazi",
      [...DIALECTS, dupInGroup],
    );
    expect(plan.rowPlans).toEqual([
      {
        submissionId: "s1",
        kind: "needs_attention",
        reason: "ambiguous",
        label: "مديني",
      },
    ]);
  });

  it("flags an empty submitted label", () => {
    const plan = planBulkApproval(
      [{ submissionId: "s1", submittedDialect: "   " }],
      "hijazi",
      DIALECTS,
    );
    expect(plan.rowPlans).toEqual([
      {
        submissionId: "s1",
        kind: "needs_attention",
        reason: "empty_label",
        label: "",
      },
    ]);
  });

  it("ignores an inactive dialect when matching, treating it as absent", () => {
    const inactive: DialectTaxonomyRow = {
      id: "retired",
      nameAr: "قديم",
      parentId: "hijazi-main",
      mainGroupCode: "hijazi",
      isActive: false,
    };
    const plan = planBulkApproval(
      [{ submissionId: "s1", submittedDialect: "قديم" }],
      "hijazi",
      [...DIALECTS, inactive],
    );
    expect(plan.rowPlans[0]).toMatchObject({ kind: "create" });
  });
});

describe("summarizeBulkApprovalPlan", () => {
  it("counts each row into exactly one bucket", () => {
    const plan = planBulkApproval(
      [
        { submissionId: "s1", submittedDialect: "مديني" }, // reuse
        { submissionId: "s2", submittedDialect: "حجازي" }, // main_group
        { submissionId: "s3", submittedDialect: "جداوي" }, // create
        { submissionId: "s4", submittedDialect: "قصيمي" }, // needs_attention
      ],
      "hijazi",
      DIALECTS,
    );
    expect(summarizeBulkApprovalPlan(plan)).toEqual({
      total: 4,
      reusingExisting: 1,
      creatingNew: 1,
      mainGroupOnly: 1,
      needsAttention: 1,
    });
  });
});

describe("formatBulkApprovalResultMessage", () => {
  it("uses the digit+singular form for an eleven-plus approved count", () => {
    expect(
      formatBulkApprovalResultMessage({
        approvedCount: 12,
        needsAttentionCount: 0,
      }),
    ).toBe("تم اعتماد 12 كلمة.");
  });

  it("uses digit+plural for a three-to-ten approved count", () => {
    expect(
      formatBulkApprovalResultMessage({
        approvedCount: 5,
        needsAttentionCount: 0,
      }),
    ).toBe("تم اعتماد 5 كلمات.");
  });

  it("appends the dual (subject-position) form for exactly two rows needing attention", () => {
    expect(
      formatBulkApprovalResultMessage({
        approvedCount: 12,
        needsAttentionCount: 2,
      }),
    ).toBe("تم اعتماد 12 كلمة. تحتاج كلمتان إلى مراجعة اللهجة.");
  });

  it("uses the singular form for exactly one row needing attention", () => {
    expect(
      formatBulkApprovalResultMessage({
        approvedCount: 5,
        needsAttentionCount: 1,
      }),
    ).toBe("تم اعتماد 5 كلمات. تحتاج كلمة واحدة إلى مراجعة اللهجة.");
  });

  it("uses the dual (object-position, ـين) form for exactly two approved words", () => {
    expect(
      formatBulkApprovalResultMessage({
        approvedCount: 2,
        needsAttentionCount: 0,
      }),
    ).toBe("تم اعتماد كلمتين.");
  });
});
