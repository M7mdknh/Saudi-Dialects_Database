import { describe, expect, it } from "vitest";
import {
  countMainDialects,
  pickDefaultMainDialect,
  MAIN_GROUP_ORDER,
} from "./dialect-selection";

describe("countMainDialects", () => {
  it("counts each candidate's resolved main dialect once", () => {
    const counts = countMainDialects([
      { mainGroupCode: "najdi" },
      { mainGroupCode: "najdi" },
      { mainGroupCode: "najdi" },
      { mainGroupCode: "southern" },
      { mainGroupCode: "southern" },
    ]);
    expect(counts).toEqual({ najdi: 3, southern: 2 });
  });

  it("ignores candidates with no resolved dialect", () => {
    const counts = countMainDialects([
      { mainGroupCode: "hijazi" },
      { mainGroupCode: null },
    ]);
    expect(counts).toEqual({ hijazi: 1 });
  });
});

describe("pickDefaultMainDialect", () => {
  it("a group with three Najdi and two Southern sources defaults to Najdi", () => {
    const counts = countMainDialects([
      { mainGroupCode: "najdi" },
      { mainGroupCode: "najdi" },
      { mainGroupCode: "najdi" },
      { mainGroupCode: "southern" },
      { mainGroupCode: "southern" },
    ]);
    expect(pickDefaultMainDialect({ counts })).toBe("najdi");
  });

  it("returns null when there are no counted candidates", () => {
    expect(pickDefaultMainDialect({ counts: {} })).toBeNull();
  });

  it("deterministic tie-break 1: prefers the existing canonical primary dialect", () => {
    const counts = { najdi: 2, southern: 2 };
    expect(
      pickDefaultMainDialect({ counts, canonicalPrimaryCode: "southern" }),
    ).toBe("southern");
  });

  it("deterministic tie-break 2: prefers the selected base candidate's dialect when there is no canonical entry", () => {
    const counts = { najdi: 2, southern: 2 };
    expect(
      pickDefaultMainDialect({ counts, baseCandidateCode: "southern" }),
    ).toBe("southern");
  });

  it("tie-break 1 outranks tie-break 2 when both apply", () => {
    const counts = { najdi: 2, southern: 2, hijazi: 2 };
    expect(
      pickDefaultMainDialect({
        counts,
        canonicalPrimaryCode: "hijazi",
        baseCandidateCode: "southern",
      }),
    ).toBe("hijazi");
  });

  it("deterministic tie-break 3: falls back to stable main-group order when neither canonical nor base apply", () => {
    const counts = { southern: 2, najdi: 2 };
    // Neither canonicalPrimaryCode nor baseCandidateCode is among the tied
    // leaders — MAIN_GROUP_ORDER decides: najdi precedes southern.
    expect(
      pickDefaultMainDialect({
        counts,
        canonicalPrimaryCode: "eastern",
        baseCandidateCode: "hijazi",
      }),
    ).toBe("najdi");
    expect(MAIN_GROUP_ORDER.indexOf("najdi")).toBeLessThan(
      MAIN_GROUP_ORDER.indexOf("southern"),
    );
  });

  it("a tie-break candidate not among the tied leaders is ignored", () => {
    const counts = { najdi: 3, southern: 2 };
    // najdi already wins outright (no tie) — canonicalPrimaryCode pointing
    // elsewhere must not override a clear majority.
    expect(
      pickDefaultMainDialect({ counts, canonicalPrimaryCode: "southern" }),
    ).toBe("najdi");
  });

  it("a single represented dialect is always the default", () => {
    const counts = countMainDialects([
      { mainGroupCode: "hijazi" },
      { mainGroupCode: "hijazi" },
    ]);
    expect(pickDefaultMainDialect({ counts })).toBe("hijazi");
  });
});
