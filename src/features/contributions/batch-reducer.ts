import type { WordCardInput } from "./schema";
import { MAX_EXAMPLES_PER_WORD, MAX_WORD_CARDS } from "./constants";

let counter = 0;
export function makeClientId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function emptyWordCard(): WordCardInput {
  return {
    clientId: makeClientId("word"),
    word: "",
    dialect: "",
    msaSynonym: "",
    explanation: "",
    examples: [{ sentence: "" }],
  };
}

export interface BatchState {
  words: WordCardInput[];
  consent: boolean;
}

export type BatchAction =
  | { type: "ADD_WORD" }
  | { type: "REMOVE_WORD"; clientId: string }
  | { type: "MOVE_WORD"; clientId: string; direction: "up" | "down" }
  | {
      type: "UPDATE_WORD";
      clientId: string;
      field: "word" | "dialect" | "msaSynonym" | "explanation";
      value: string;
    }
  | { type: "ADD_EXAMPLE"; clientId: string }
  | { type: "REMOVE_EXAMPLE"; clientId: string; index: number }
  | { type: "UPDATE_EXAMPLE"; clientId: string; index: number; value: string }
  | { type: "SET_CONSENT"; value: boolean }
  | { type: "LOAD_DRAFT"; words: WordCardInput[]; consent: boolean }
  | { type: "RESET" };

export function initialBatchState(): BatchState {
  return { words: [emptyWordCard()], consent: false };
}

export function batchReducer(
  state: BatchState,
  action: BatchAction,
): BatchState {
  switch (action.type) {
    case "ADD_WORD": {
      if (state.words.length >= MAX_WORD_CARDS) return state;
      return { ...state, words: [...state.words, emptyWordCard()] };
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
        words: state.words.map((w) =>
          w.clientId === action.clientId
            ? { ...w, [action.field]: action.value }
            : w,
        ),
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
