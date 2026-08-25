import { beforeEach, describe, expect, it } from "vitest";
import {
  getAnsweredThisSessionIds,
  getExclusionIds,
  getRecentlyShownIds,
  recordAnsweredId,
  recordShownIds,
} from "./prompt-history";

const RECENTLY_SHOWN_KEY = "lahajat.prompts.recently-shown.v1";
const ANSWERED_THIS_SESSION_KEY = "lahajat.prompts.answered-session.v1";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("prompt-history", () => {
  it("round-trips recently-shown and answered ids", () => {
    recordShownIds(["a", "b"]);
    recordAnsweredId("a");
    expect(getRecentlyShownIds()).toEqual(["a", "b"]);
    expect(getAnsweredThisSessionIds()).toEqual(["a"]);
    expect(getExclusionIds().sort()).toEqual(["a", "b"]);
  });

  it("recovers safely from corrupt localStorage JSON instead of throwing", () => {
    window.localStorage.setItem(RECENTLY_SHOWN_KEY, "{not valid json");
    expect(getRecentlyShownIds()).toEqual([]);
    // A subsequent write must still work after the corrupt read.
    recordShownIds(["x"]);
    expect(getRecentlyShownIds()).toEqual(["x"]);
  });

  it("recovers safely from a non-array value stored under the key", () => {
    window.localStorage.setItem(
      RECENTLY_SHOWN_KEY,
      JSON.stringify({ not: "an array" }),
    );
    expect(getRecentlyShownIds()).toEqual([]);
  });

  it("recovers safely from corrupt sessionStorage JSON", () => {
    window.sessionStorage.setItem(ANSWERED_THIS_SESSION_KEY, "]][[");
    expect(getAnsweredThisSessionIds()).toEqual([]);
  });

  it("ages out the oldest recently-shown ids once the cap is exceeded (exhaustion never permanently blocks all prompts)", () => {
    for (let batch = 0; batch < 10; batch += 1) {
      recordShownIds(Array.from({ length: 6 }, (_, i) => `batch${batch}-${i}`));
    }
    const ids = getRecentlyShownIds();
    expect(ids.length).toBeLessThanOrEqual(42);
    // The earliest batch must have aged out (FIFO), proving the exclusion
    // list itself cannot grow without bound and lock a visitor out forever.
    expect(ids).not.toContain("batch0-0");
  });
});
