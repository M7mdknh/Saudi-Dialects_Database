import { describe, expect, it } from "vitest";
import { batchReducer, initialBatchState } from "./batch-reducer";
import { MAX_WORD_CARDS } from "./constants";

describe("batchReducer", () => {
  it("starts with exactly one word card and no consent", () => {
    const state = initialBatchState();
    expect(state.words).toHaveLength(1);
    expect(state.consent).toBe(false);
  });

  it("adds a word card up to the maximum", () => {
    let state = initialBatchState();
    for (let i = 0; i < MAX_WORD_CARDS + 5; i++) {
      state = batchReducer(state, { type: "ADD_WORD" });
    }
    expect(state.words).toHaveLength(MAX_WORD_CARDS);
  });

  it("never removes the last remaining word card", () => {
    const state = initialBatchState();
    const next = batchReducer(state, {
      type: "REMOVE_WORD",
      clientId: state.words[0].clientId,
    });
    expect(next.words).toHaveLength(1);
  });

  it("reorders word cards with MOVE_WORD", () => {
    let state = initialBatchState();
    state = batchReducer(state, { type: "ADD_WORD" });
    const [first, second] = state.words;
    state = batchReducer(state, {
      type: "MOVE_WORD",
      clientId: second.clientId,
      direction: "up",
    });
    expect(state.words[0].clientId).toBe(second.clientId);
    expect(state.words[1].clientId).toBe(first.clientId);
  });

  it("never removes the last example of a word card", () => {
    const state = initialBatchState();
    const clientId = state.words[0].clientId;
    const next = batchReducer(state, {
      type: "REMOVE_EXAMPLE",
      clientId,
      index: 0,
    });
    expect(next.words[0].examples).toHaveLength(1);
  });

  it("adds and removes additional examples", () => {
    let state = initialBatchState();
    const clientId = state.words[0].clientId;
    state = batchReducer(state, { type: "ADD_EXAMPLE", clientId });
    expect(state.words[0].examples).toHaveLength(2);
    state = batchReducer(state, { type: "REMOVE_EXAMPLE", clientId, index: 1 });
    expect(state.words[0].examples).toHaveLength(1);
  });
});
