import { describe, expect, it } from "vitest";
import {
  formatApprovedCount,
  formatParticipationCount,
  formatParticipationCountGenitive,
} from "./format";

describe("formatParticipationCount (Arabic singular/dual/plural agreement)", () => {
  it("uses the compact digit+singular form for zero", () => {
    expect(formatParticipationCount(0)).toBe("٠ مساهمة");
  });
  it("uses the singular + واحدة form for one", () => {
    expect(formatParticipationCount(1)).toBe("مساهمة واحدة");
  });
  it("uses the dual form for two", () => {
    expect(formatParticipationCount(2)).toBe("مساهمتان");
  });
  it("uses digit+plural for three through ten", () => {
    expect(formatParticipationCount(3)).toBe("٣ مساهمات");
    expect(formatParticipationCount(10)).toBe("١٠ مساهمات");
  });
  it("uses digit+singular for eleven and above", () => {
    expect(formatParticipationCount(11)).toBe("١١ مساهمة");
    expect(formatParticipationCount(128)).toBe("١٢٨ مساهمة");
  });
});

describe("formatParticipationCountGenitive (dual مضاف إليه form, e.g. after بفارق)", () => {
  it("uses the genitive dual (مساهمتين) instead of the nominative dual", () => {
    expect(formatParticipationCountGenitive(2)).toBe("مساهمتين");
  });
  it("matches the nominative form everywhere else", () => {
    expect(formatParticipationCountGenitive(0)).toBe("٠ مساهمة");
    expect(formatParticipationCountGenitive(1)).toBe("مساهمة واحدة");
    expect(formatParticipationCountGenitive(3)).toBe("٣ مساهمات");
    expect(formatParticipationCountGenitive(11)).toBe("١١ مساهمة");
  });
});

describe("formatApprovedCount (same agreement rules, distinct noun)", () => {
  it("uses the compact digit+singular form for zero", () => {
    expect(formatApprovedCount(0)).toBe("٠ كلمة معتمدة");
  });
  it("uses the singular + واحدة form for one", () => {
    expect(formatApprovedCount(1)).toBe("كلمة معتمدة واحدة");
  });
  it("uses the dual form for two", () => {
    expect(formatApprovedCount(2)).toBe("كلمتان معتمدتان");
  });
  it("uses digit+plural for three through ten", () => {
    expect(formatApprovedCount(3)).toBe("٣ كلمات معتمدة");
  });
  it("uses digit+singular for eleven and above", () => {
    expect(formatApprovedCount(42)).toBe("٤٢ كلمة معتمدة");
  });
});
