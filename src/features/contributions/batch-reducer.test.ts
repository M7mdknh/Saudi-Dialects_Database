import { describe, expect, it } from "vitest";
import { batchReducer, initialBatchState } from "./batch-reducer";
import { MAX_WORD_CARDS } from "./constants";
import type { GuidedPromptRecord } from "@/features/prompts/types";

const samplePrompt: GuidedPromptRecord = {
  id: "rice",
  category: "food_staples",
  categoryLabelAr: "الطعام والشراب اليومي",
  msaLemma: "أرز",
  definitionAr: "حبوب مطبوخة تُقدّم طعامًا رئيسيًا",
  scenarioAr: "ما الكلمة التي تستخدمها عادة للأرز المطبوخ؟",
  partOfSpeech: "noun",
  answerForm: "word_or_phrase",
  priority: 90,
  promptVersion: 1,
};

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

  it("ADD_GUIDED_WORD prefills the synonym and meaning, leaves word/dialect empty", () => {
    const state = batchReducer(initialBatchState(), {
      type: "ADD_GUIDED_WORD",
      prompt: samplePrompt,
    });
    const card = state.words[state.words.length - 1];
    expect(card.msaSynonym).toBe("أرز");
    expect(card.explanation).toBe("حبوب مطبوخة تُقدّم طعامًا رئيسيًا");
    expect(card.word).toBe("");
    expect(card.dialect).toBe("");
    expect(card.referencePromptId).toBe("rice");
    expect(card.referencePromptSnapshot?.msaLemma).toBe("أرز");
  });

  it("UPDATE_WORD ignores attempts to edit the read-only guided fields", () => {
    let state = batchReducer(initialBatchState(), {
      type: "ADD_GUIDED_WORD",
      prompt: samplePrompt,
    });
    const clientId = state.words[state.words.length - 1].clientId;
    state = batchReducer(state, {
      type: "UPDATE_WORD",
      clientId,
      field: "msaSynonym",
      value: "متلاعب به",
    });
    const card = state.words.find((w) => w.clientId === clientId)!;
    expect(card.msaSynonym).toBe("أرز");
  });

  it("UPDATE_WORD still allows editing the dialect word on a guided card", () => {
    let state = batchReducer(initialBatchState(), {
      type: "ADD_GUIDED_WORD",
      prompt: samplePrompt,
    });
    const clientId = state.words[state.words.length - 1].clientId;
    state = batchReducer(state, {
      type: "UPDATE_WORD",
      clientId,
      field: "word",
      value: "عيش",
    });
    const card = state.words.find((w) => w.clientId === clientId)!;
    expect(card.word).toBe("عيش");
  });

  it("ADD_ANOTHER_FOR_SAME_PROMPT inserts a second card for the same concept right after the first", () => {
    let state = batchReducer(initialBatchState(), {
      type: "ADD_GUIDED_WORD",
      prompt: samplePrompt,
    });
    const clientId = state.words[state.words.length - 1].clientId;
    state = batchReducer(state, {
      type: "ADD_ANOTHER_FOR_SAME_PROMPT",
      clientId,
    });
    const index = state.words.findIndex((w) => w.clientId === clientId);
    expect(state.words[index + 1].referencePromptId).toBe("rice");
    expect(state.words[index + 1].msaSynonym).toBe("أرز");
    expect(state.words[index + 1].word).toBe("");
    expect(state.words[index + 1].clientId).not.toBe(clientId);
  });

  it("ordinary (non-guided) cards keep referencePromptId null", () => {
    const state = initialBatchState();
    expect(state.words[0].referencePromptId).toBeNull();
  });

  describe("PRESELECT_MAIN_GROUP", () => {
    it("sets the first card's dialect label and provisional group, with no dialectId", () => {
      const state = initialBatchState();
      const next = batchReducer(state, {
        type: "PRESELECT_MAIN_GROUP",
        code: "hijazi",
        label: "حجازي",
      });
      expect(next.words[0].dialect).toBe("حجازي");
      expect(next.words[0].dialectId).toBeNull();
      expect(next.words[0].provisionalMainGroupCode).toBe("hijazi");
    });

    it("never overwrites a dialect the visitor already typed or chose", () => {
      let state = initialBatchState();
      state = batchReducer(state, {
        type: "UPDATE_DIALECT",
        clientId: state.words[0].clientId,
        dialect: "جداوي",
        dialectId: "11111111-1111-4111-8111-111111111111",
      });
      const next = batchReducer(state, {
        type: "PRESELECT_MAIN_GROUP",
        code: "najdi",
        label: "نجدي",
      });
      expect(next.words[0].dialect).toBe("جداوي");
      expect(next.words[0].dialectId).toBe(
        "11111111-1111-4111-8111-111111111111",
      );
    });

    it("only touches the first card, leaving additional cards untouched", () => {
      let state = initialBatchState();
      state = batchReducer(state, { type: "ADD_WORD" });
      const secondClientId = state.words[1].clientId;
      const next = batchReducer(state, {
        type: "PRESELECT_MAIN_GROUP",
        code: "eastern",
        label: "شرقاوي",
      });
      expect(next.words[1].clientId).toBe(secondClientId);
      expect(next.words[1].dialect).toBe("");
    });
  });
});
