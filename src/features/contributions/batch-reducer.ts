import type { WordCardInput } from "./schema";
import { MAX_EXAMPLES_PER_WORD, MAX_WORD_CARDS } from "./constants";
import type { GuidedPromptRecord } from "@/features/prompts/types";
import { toSnapshot } from "@/features/prompts/types";

let counter = 0;
export function makeClientId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function emptyWordCard(guided?: GuidedPromptRecord): WordCardInput {
  return {
    clientId: makeClientId("word"),
    word: "",
    dialect: "",
    dialectId: null,
    provisionalMainGroupCode: null,
    msaSynonym: guided?.msaLemma ?? "",
    explanation: guided?.definitionAr ?? "",
    examples: [{ sentence: "" }],
    referencePromptId: guided?.id ?? null,
    referencePromptSnapshot: guided ? toSnapshot(guided) : null,
  };
}

export interface BatchState {
  words: WordCardInput[];
  consent: boolean;
}

export type BatchAction =
  | { type: "ADD_WORD" }
  | { type: "ADD_GUIDED_WORD"; prompt: GuidedPromptRecord }
  | { type: "ADD_ANOTHER_FOR_SAME_PROMPT"; clientId: string }
  | { type: "REMOVE_WORD"; clientId: string }
  | { type: "MOVE_WORD"; clientId: string; direction: "up" | "down" }
  | {
      type: "UPDATE_WORD";
      clientId: string;
      field: "word" | "dialect" | "msaSynonym" | "explanation";
      value: string;
    }
  | {
      type: "UPDATE_DIALECT";
      clientId: string;
      dialect: string;
      dialectId: string | null;
    }
  | {
      type: "UPDATE_PROVISIONAL_MAIN_GROUP";
      clientId: string;
      value: string;
    }
  | { type: "PRESELECT_MAIN_GROUP"; code: string; label: string }
  | { type: "ADD_EXAMPLE"; clientId: string }
  | { type: "REMOVE_EXAMPLE"; clientId: string; index: number }
  | { type: "UPDATE_EXAMPLE"; clientId: string; index: number; value: string }
  | { type: "SET_CONSENT"; value: boolean }
  | { type: "LOAD_DRAFT"; words: WordCardInput[]; consent: boolean }
  | { type: "RESET" };

export function initialBatchState(): BatchState {
  return { words: [emptyWordCard()], consent: false };
}

/** Guided reference fields (synonym/meaning) are read-only from the UI, so a stray UPDATE_WORD for them is ignored defensively. */
const READ_ONLY_WHEN_GUIDED = new Set(["msaSynonym", "explanation"]);

export function batchReducer(
  state: BatchState,
  action: BatchAction,
): BatchState {
  switch (action.type) {
    case "ADD_WORD": {
      if (state.words.length >= MAX_WORD_CARDS) return state;
      return { ...state, words: [...state.words, emptyWordCard()] };
    }
    case "ADD_GUIDED_WORD": {
      if (state.words.length >= MAX_WORD_CARDS) return state;
      return {
        ...state,
        words: [...state.words, emptyWordCard(action.prompt)],
      };
    }
    case "ADD_ANOTHER_FOR_SAME_PROMPT": {
      if (state.words.length >= MAX_WORD_CARDS) return state;
      const source = state.words.find((w) => w.clientId === action.clientId);
      if (!source || !source.referencePromptSnapshot) return state;
      const duplicate: WordCardInput = {
        clientId: makeClientId("word"),
        word: "",
        dialect: "",
        dialectId: null,
        provisionalMainGroupCode: null,
        msaSynonym: source.msaSynonym,
        explanation: source.explanation,
        examples: [{ sentence: "" }],
        referencePromptId: source.referencePromptId,
        referencePromptSnapshot: source.referencePromptSnapshot,
      };
      const index = state.words.findIndex(
        (w) => w.clientId === action.clientId,
      );
      const words = [...state.words];
      words.splice(index + 1, 0, duplicate);
      return { ...state, words };
    }
    case "REMOVE_WORD": {
      if (state.words.length <= 1) return state;
      return {
        ...state,
        words: state.words.filter((w) => w.clientId !== action.clientId),
      };
    }
    case "MOVE_WORD": {
      const index = state.words.findIndex(
        (w) => w.clientId === action.clientId,
      );
      if (index === -1) return state;
      const target = action.direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= state.words.length) return state;
      const words = [...state.words];
      [words[index], words[target]] = [words[target], words[index]];
      return { ...state, words };
    }
    case "UPDATE_WORD": {
      return {
        ...state,
        words: state.words.map((w) => {
          if (w.clientId !== action.clientId) return w;
          if (w.referencePromptId && READ_ONLY_WHEN_GUIDED.has(action.field))
            return w;
          return { ...w, [action.field]: action.value };
        }),
      };
    }
    case "UPDATE_DIALECT": {
      return {
        ...state,
        words: state.words.map((w) =>
          w.clientId === action.clientId
            ? { ...w, dialect: action.dialect, dialectId: action.dialectId }
            : w,
        ),
      };
    }
    case "UPDATE_PROVISIONAL_MAIN_GROUP": {
      return {
        ...state,
        words: state.words.map((w) =>
          w.clientId === action.clientId
            ? {
                ...w,
                provisionalMainGroupCode:
                  (action.value as WordCardInput["provisionalMainGroupCode"]) ||
                  null,
              }
            : w,
        ),
      };
    }
    case "PRESELECT_MAIN_GROUP": {
      // Only touches the first (base) card, and only while it's still
      // pristine — never overwrites a dialect the visitor already
      // typed/chose, or a restored draft's own selection.
      const [firstWord, ...restWords] = state.words;
      if (!firstWord || firstWord.dialect) return state;
      return {
        ...state,
        words: [
          {
            ...firstWord,
            dialect: action.label,
            dialectId: null,
            provisionalMainGroupCode:
              action.code as WordCardInput["provisionalMainGroupCode"],
          },
          ...restWords,
        ],
      };
    }
    case "ADD_EXAMPLE": {
      return {
        ...state,
        words: state.words.map((w) => {
          if (w.clientId !== action.clientId) return w;
          if (w.examples.length >= MAX_EXAMPLES_PER_WORD) return w;
          return { ...w, examples: [...w.examples, { sentence: "" }] };
        }),
      };
    }
    case "REMOVE_EXAMPLE": {
      return {
        ...state,
        words: state.words.map((w) => {
          if (w.clientId !== action.clientId) return w;
          if (w.examples.length <= 1) return w;
          return {
            ...w,
            examples: w.examples.filter((_, i) => i !== action.index),
          };
        }),
      };
    }
    case "UPDATE_EXAMPLE": {
      return {
        ...state,
        words: state.words.map((w) => {
          if (w.clientId !== action.clientId) return w;
          return {
            ...w,
            examples: w.examples.map((ex, i) =>
              i === action.index ? { sentence: action.value } : ex,
            ),
          };
        }),
      };
    }
    case "SET_CONSENT":
      return { ...state, consent: action.value };
    case "LOAD_DRAFT":
      return {
        words: action.words.length > 0 ? action.words : [emptyWordCard()],
        consent: action.consent,
      };
    case "RESET":
      return initialBatchState();
    default:
      return state;
  }
}
