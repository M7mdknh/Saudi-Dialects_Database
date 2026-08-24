import { describe, expect, it } from "vitest";
import { toSearchKey } from "./normalize-arabic";

describe("toSearchKey", () => {
  it("trims and collapses internal whitespace", () => {
    expect(toSearchKey("  سبهللة    اليوم  ")).toBe("سبهللة اليوم");
  });

  it("removes tatweel", () => {
    expect(toSearchKey("سبـــهللة")).toBe("سبهللة");
  });

  it("removes combining diacritics", () => {
    expect(toSearchKey("سَبَهْلَلَة")).toBe(toSearchKey("سبهللة"));
  });

  it("does not collapse ة/ه distinctions", () => {
    expect(toSearchKey("مدرسة")).not.toBe(toSearchKey("مدرسه"));
  });

  it("does not collapse ى/ي distinctions", () => {
    expect(toSearchKey("على")).not.toBe(toSearchKey("علي"));
  });

  it("does not collapse hamza forms", () => {
    expect(toSearchKey("أكل")).not.toBe(toSearchKey("اكل"));
  });

  it("is idempotent under NFC-equivalent input", () => {
    const composed = "أ"; // أ precomposed
    const decomposed = "أ"; // ا + combining hamza above
    expect(toSearchKey(composed)).toBe(toSearchKey(decomposed));
  });
});
