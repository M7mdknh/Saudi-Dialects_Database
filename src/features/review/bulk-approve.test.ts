import { describe, expect, it } from "vitest";
import {
  computeReadiness,
  countBulkExecutionResults,
  formatBulkApprovalResultMessage,
  formatBulkExecutionMessage,
  formatHardFailureMessage,
  formatReadinessSummary,
  planBulkApproval,
  summarizeBulkApprovalPlan,
  type BulkApprovalSourceRow,
  type BulkExecutionRowResult,
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
const EASTERN_MAIN: DialectTaxonomyRow = {
  id: "eastern-main",
  nameAr: "شرقاوي",
  parentId: null,
  mainGroupCode: "eastern",
  isActive: true,
};
const SOUTHERN_MAIN: DialectTaxonomyRow = {
  id: "southern-main",
  nameAr: "جنوبي",
  parentId: null,
  mainGroupCode: "southern",
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
const HASAWI: DialectTaxonomyRow = {
  id: "hasawi",
  nameAr: "حساوي",
  parentId: "eastern-main",
  mainGroupCode: "eastern",
  isActive: true,
};

const DIALECTS = [
  HIJAZI_MAIN,
  NAJDI_MAIN,
  EASTERN_MAIN,
  SOUTHERN_MAIN,
  MADANI,
  QASSIMI,
  HASAWI,
];

function row(overrides: Partial<BulkApprovalSourceRow>): BulkApprovalSourceRow {
  return {
    submissionId: "s1",
    submittedDialect: "",
    selectedDialectId: null,
    provisionalMainGroupCode: null,
    ...overrides,
  };
}

describe("planBulkApproval — rule 1: trusted existing local dialect", () => {
  it("resolves the trusted dialect's own parent group automatically, no batch group needed", () => {
    const plan = planBulkApproval(
      [
        row({
          submissionId: "s1",
          submittedDialect: "مديني",
          selectedDialectId: "madani",
        }),
      ],
      DIALECTS,
    );
    expect(plan.rowPlans).toEqual([
      {
        submissionId: "s1",
        kind: "trusted_local",
        dialectId: "madani",
        mainGroupCode: "hijazi",
        label: "مديني",
      },
    ]);
    expect(plan.newDialects).toEqual([]);
  });
});

describe("planBulkApproval — rule 2: main group selected directly", () => {
  it("resolves the main group itself when the trusted selection is a main-group row (no parent)", () => {
    const plan = planBulkApproval(
      [
        row({
          submissionId: "s1",
          submittedDialect: "جنوبي",
          selectedDialectId: "southern-main",
        }),
      ],
      DIALECTS,
    );
    expect(plan.rowPlans).toEqual([
      {
        submissionId: "s1",
        kind: "main_group",
        dialectId: "southern-main",
        mainGroupCode: "southern",
        label: "جنوبي",
      },
    ]);
  });
});

describe("planBulkApproval — rule 3: custom local label with provisional group", () => {
  it("proposes creating the local label under the contributor's own provisional group", () => {
    const plan = planBulkApproval(
      [
        row({
          submissionId: "s1",
          submittedDialect: "جداوي",
          provisionalMainGroupCode: "hijazi",
        }),
      ],
      DIALECTS,
    );
    expect(plan.rowPlans).toEqual([
      {
        submissionId: "s1",
        kind: "create_local",
        key: "hijazi::جداوي",
        mainGroupCode: "hijazi",
        label: "جداوي",
      },
    ]);
    expect(plan.newDialects).toEqual([
      {
        key: "hijazi::جداوي",
        label: "جداوي",
        slug: "جداوي",
        mainGroupCode: "hijazi",
      },
    ]);
  });

  it("reuses a dialect that already exists under the provisional group instead of duplicating it", () => {
    const plan = planBulkApproval(
      [
        row({
          submissionId: "s1",
          submittedDialect: "حساوي",
          provisionalMainGroupCode: "eastern",
        }),
      ],
      DIALECTS,
    );
    expect(plan.rowPlans).toEqual([
      {
        submissionId: "s1",
        kind: "trusted_local",
        dialectId: "hasawi",
        mainGroupCode: "eastern",
        label: "حساوي",
      },
    ]);
  });

  it("keys new-dialect proposals by group so the same label under two groups creates two proposals", () => {
    const plan = planBulkApproval(
      [
        row({
          submissionId: "s1",
          submittedDialect: "بدوي",
          provisionalMainGroupCode: "hijazi",
        }),
        row({
          submissionId: "s2",
          submittedDialect: "بدوي",
          provisionalMainGroupCode: "najdi",
        }),
      ],
      DIALECTS,
    );
    expect(plan.newDialects).toHaveLength(2);
    expect(plan.newDialects.map((d) => d.mainGroupCode).sort()).toEqual([
      "hijazi",
      "najdi",
    ]);
  });
});

describe("planBulkApproval — rule 4: legacy/unresolved submission", () => {
  it("flags a submission with no trusted dialect and no provisional group", () => {
    const plan = planBulkApproval(
      [row({ submissionId: "s1", submittedDialect: "لهجة قديمة" })],
      DIALECTS,
    );
    expect(plan.rowPlans).toEqual([
      {
        submissionId: "s1",
        kind: "needs_attention",
        reason: "missing_classification",
        label: "لهجة قديمة",
      },
    ]);
  });
});

describe("planBulkApproval — conflict / ambiguity", () => {
  it("flags a stale/invalid trusted dialect id (deleted or deactivated since submission)", () => {
    const plan = planBulkApproval(
      [
        row({
          submissionId: "s1",
          submittedDialect: "مديني",
          selectedDialectId: "does-not-exist",
        }),
      ],
      DIALECTS,
    );
    expect(plan.rowPlans).toEqual([
      {
        submissionId: "s1",
        kind: "needs_attention",
        reason: "invalid_trusted_dialect",
        label: "مديني",
      },
    ]);
  });

  it("flags a custom label matching a dialect under a different trusted group", () => {
    const plan = planBulkApproval(
      [
        row({
          submissionId: "s1",
          submittedDialect: "قصيمي",
          provisionalMainGroupCode: "hijazi",
        }),
      ],
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
      [
        row({
          submissionId: "s1",
          submittedDialect: "مديني",
          provisionalMainGroupCode: "hijazi",
        }),
      ],
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

  it("flags an empty submitted label even when a provisional group is present", () => {
    const plan = planBulkApproval(
      [
        row({
          submissionId: "s1",
          submittedDialect: "   ",
          provisionalMainGroupCode: "hijazi",
        }),
      ],
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
      [
        row({
          submissionId: "s1",
          submittedDialect: "قديم",
          provisionalMainGroupCode: "hijazi",
        }),
      ],
      [...DIALECTS, inactive],
    );
    expect(plan.rowPlans[0]).toMatchObject({ kind: "create_local" });
  });
});

describe("planBulkApproval — mixed-group batch", () => {
  it("classifies every row independently under its own correct group in one plan", () => {
    const plan = planBulkApproval(
      [
        row({
          submissionId: "s1",
          submittedDialect: "مديني",
          selectedDialectId: "madani",
        }),
        row({
          submissionId: "s2",
          submittedDialect: "قصيمي",
          selectedDialectId: "qassimi",
        }),
        row({
          submissionId: "s3",
          submittedDialect: "حساوي",
          selectedDialectId: "hasawi",
        }),
        row({
          submissionId: "s4",
          submittedDialect: "جنوبي",
          selectedDialectId: "southern-main",
        }),
      ],
      DIALECTS,
    );
    expect(
      plan.rowPlans.map((r) => (r as { mainGroupCode: string }).mainGroupCode),
    ).toEqual(["hijazi", "najdi", "eastern", "southern"]);
    expect(computeReadiness(plan)).toEqual({
      total: 4,
      ready: 4,
      needsAttention: 0,
    });
  });

  it("does not block resolvable rows because one row in the batch is unresolved", () => {
    const plan = planBulkApproval(
      [
        row({
          submissionId: "s1",
          submittedDialect: "مديني",
          selectedDialectId: "madani",
        }),
        row({
          submissionId: "s2",
          submittedDialect: "قصيمي",
          selectedDialectId: "qassimi",
        }),
        row({
          submissionId: "s3",
          submittedDialect: "حساوي",
          selectedDialectId: "hasawi",
        }),
        row({
          submissionId: "s4",
          submittedDialect: "جنوبي",
          selectedDialectId: "southern-main",
        }),
        row({ submissionId: "s5", submittedDialect: "لهجة غير معروفة" }),
      ],
      DIALECTS,
    );
    expect(computeReadiness(plan)).toEqual({
      total: 5,
      ready: 4,
      needsAttention: 1,
    });
  });
});

describe("computeReadiness / formatReadinessSummary", () => {
  it("reports only the ready count when nothing needs attention", () => {
    const plan = planBulkApproval(
      [
        row({
          submissionId: "s1",
          submittedDialect: "مديني",
          selectedDialectId: "madani",
        }),
      ],
      DIALECTS,
    );
    expect(formatReadinessSummary(computeReadiness(plan))).toBe(
      "جاهزة للاعتماد: 1",
    );
  });

  it("appends the needs-attention count when present", () => {
    const readiness = { total: 5, ready: 4, needsAttention: 1 };
    expect(formatReadinessSummary(readiness)).toBe(
      "جاهزة للاعتماد: 4 — تحتاج مراجعة: 1",
    );
  });
});

describe("summarizeBulkApprovalPlan", () => {
  it("counts each row into exactly one bucket", () => {
    const plan = planBulkApproval(
      [
        row({
          submissionId: "s1",
          submittedDialect: "مديني",
          selectedDialectId: "madani",
        }), // trusted_local
        row({
          submissionId: "s2",
          submittedDialect: "حجازي",
          selectedDialectId: "hijazi-main",
        }), // main_group
        row({
          submissionId: "s3",
          submittedDialect: "جداوي",
          provisionalMainGroupCode: "hijazi",
        }), // create_local
        row({ submissionId: "s4", submittedDialect: "؟؟" }), // needs_attention
      ],
      DIALECTS,
    );
    expect(summarizeBulkApprovalPlan(plan)).toEqual({
      total: 4,
      ready: 3,
      needsAttention: 1,
      reusingExisting: 1,
      creatingNew: 1,
      mainGroupOnly: 1,
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

describe("countBulkExecutionResults", () => {
  it("buckets every row into exactly one status, matching requestedCount even when some rows never got a plan row (e.g. no dialect resolved at all)", () => {
    const rows: BulkExecutionRowResult[] = [
      { submissionId: "s1", status: "approved", entryId: "e1" },
      { submissionId: "s2", status: "needs_classification" },
      { submissionId: "s3", status: "conflict" },
      { submissionId: "s4", status: "failed", errorCode: "INVALID_DIALECT" },
    ];
    expect(countBulkExecutionResults(rows, 5)).toEqual({
      requestedCount: 5,
      approvedCount: 1,
      needsClassificationCount: 1,
      conflictCount: 1,
      failedCount: 1,
    });
  });
});

describe("formatBulkExecutionMessage", () => {
  it("matches the documented public quick-approval result exactly", () => {
    expect(
      formatBulkExecutionMessage(
        {
          requestedCount: 25,
          approvedCount: 23,
          needsClassificationCount: 1,
          conflictCount: 1,
          failedCount: 0,
        },
        "public",
      ),
    ).toBe(
      "تم اعتماد 23 كلمة ونشرها.\n" +
        "تحتاج كلمة واحدة إلى مراجعة اللهجة.\n" +
        "تعارض تحديث كلمة واحدة؛ حدّث الصفحة وحاول مجددًا.",
    );
  });

  it("uses the private wording when approving without publishing", () => {
    expect(
      formatBulkExecutionMessage(
        {
          requestedCount: 3,
          approvedCount: 3,
          needsClassificationCount: 0,
          conflictCount: 0,
          failedCount: 0,
        },
        "private",
      ),
    ).toBe("تم اعتماد 3 كلمات دون نشرها.");
  });

  it("reports an unexpected-error line distinct from a conflict line", () => {
    expect(
      formatBulkExecutionMessage(
        {
          requestedCount: 1,
          approvedCount: 0,
          needsClassificationCount: 0,
          conflictCount: 0,
          failedCount: 1,
        },
        "public",
      ),
    ).toBe("تعذّر اعتماد كلمة واحدة بسبب خطأ غير متوقع.");
  });
});

describe("formatHardFailureMessage", () => {
  it("gives a stable, specific message per category instead of one generic catch-all", () => {
    expect(formatHardFailureMessage("session_expired", "abc")).toBe(
      "تعذّر الاعتماد بسبب انتهاء الجلسة.",
    );
    expect(formatHardFailureMessage("missing_function", "abc")).toBe(
      "تعذّر العثور على دالة الاعتماد في قاعدة البيانات.",
    );
    expect(formatHardFailureMessage("data_conflict", "abc")).toBe(
      "تعذّر الاعتماد بسبب تعارض البيانات.",
    );
  });

  it("includes the correlation id only in the unknown-category fallback", () => {
    const message = formatHardFailureMessage("unknown", "corr-123");
    expect(message).toContain("corr-123");
  });
});
