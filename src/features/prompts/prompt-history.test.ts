import { beforeEach, describe, expect, it } from "vitest";
import {
  getAnsweredCount,
  getAnsweredIds,
  getPromptOffset,
  isAnswered,
  recordAnsweredId,
  resetAnsweredIds,
  setPromptOffset,
} from "./prompt-history";

const OFFSET_KEY = "lahajat.prompts.offset.v2";
const ANSWERED_KEY = "lahajat.prompts.answered.v2";

beforeEach(() => {
  window.localStorage.clear();
});

describe("prompt-history: ordered position", () => {
  it("defaults to offset 0", () => {
    expect(getPromptOffset()).toBe(0);
  });

  it("round-trips a stored offset", () => {
    setPromptOffset(18);
    expect(getPromptOffset()).toBe(18);
  });

  it("clamps a negative offset to 0", () => {
    setPromptOffset(-5);
    expect(getPromptOffset()).toBe(0);
  });

  it("recovers safely from corrupt localStorage JSON instead of throwing", () => {
    window.localStorage.setItem(OFFSET_KEY, "{not valid json");
    expect(getPromptOffset()).toBe(0);
  });

  it("recovers safely from a non-numeric value stored under the key", () => {
    window.localStorage.setItem(OFFSET_KEY, JSON.stringify("not a number"));
    expect(getPromptOffset()).toBe(0);
  });
});

describe("prompt-history: answered-on-this-device state", () => {
  it("round-trips answered ids and never duplicates", () => {
    recordAnsweredId("a");
    recordAnsweredId("b");
    recordAnsweredId("a");
    expect(getAnsweredIds().sort()).toEqual(["a", "b"]);
    expect(getAnsweredCount()).toBe(2);
    expect(isAnswered("a")).toBe(true);
    expect(isAnswered("z")).toBe(false);
  });

  it("recovers safely from corrupt localStorage JSON", () => {
    window.localStorage.setItem(ANSWERED_KEY, "]][[");
    expect(getAnsweredIds()).toEqual([]);
    // A subsequent write must still work after the corrupt read.
    recordAnsweredId("x");
    expect(getAnsweredIds()).toEqual(["x"]);
  });

  it("recovers safely from a non-array value stored under the key", () => {
    window.localStorage.setItem(
      ANSWERED_KEY,
      JSON.stringify({ not: "an array" }),
    );
    expect(getAnsweredIds()).toEqual([]);
  });

  it("reset clears local progress without throwing when nothing was stored", () => {
    expect(() => resetAnsweredIds()).not.toThrow();
    recordAnsweredId("a");
    resetAnsweredIds();
    expect(getAnsweredIds()).toEqual([]);
  });
});
