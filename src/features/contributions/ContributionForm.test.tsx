import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GuidedPromptRecord } from "@/features/prompts/types";
import type { GuidedPromptPage } from "@/features/prompts/actions";
import type { PublicDialectOption } from "./dialects-actions";

const listReferencePromptsPageMock = vi.fn();
vi.mock("@/features/prompts/actions", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/prompts/actions")
  >("@/features/prompts/actions");
  return {
    ...actual,
    listReferencePromptsPage: (...args: unknown[]) =>
      listReferencePromptsPageMock(...args),
  };
});

const listPublicDialectsMock = vi.fn();
vi.mock("./dialects-actions", () => ({
  listPublicDialects: (...args: unknown[]) => listPublicDialectsMock(...args),
}));

let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

const { ContributionForm } = await import("./ContributionForm");

const ricePrompt: GuidedPromptRecord = {
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

function page(
  rows: GuidedPromptRecord[],
  total = rows.length,
): GuidedPromptPage {
  return { rows, total };
}

const dialectOptions: PublicDialectOption[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    nameAr: "حجازي",
    slug: "hijazi-main",
    parentId: null,
    mainGroupCode: "hijazi",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    nameAr: "نجدي",
    slug: "najdi-main",
    parentId: null,
    mainGroupCode: "najdi",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    nameAr: "جداوي",
    slug: "jeddawi",
    parentId: "11111111-1111-4111-8111-111111111111",
    mainGroupCode: "hijazi",
  },
];

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.location.hash = "";
  listReferencePromptsPageMock.mockReset();
  listReferencePromptsPageMock.mockResolvedValue(page([]));
  listPublicDialectsMock.mockReset();
  listPublicDialectsMock.mockResolvedValue([]);
  mockSearchParams = new URLSearchParams();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ContributionForm", () => {
  it("renders one word card by default with the required fields", () => {
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "ساهم بكلمة من لهجتك" }),
    ).toBeInTheDocument();
    expect(screen.getByText("الكلمة ١")).toBeInTheDocument();
  });

  it("adds another word card when the add-word button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );
    await user.click(screen.getByRole("button", { name: "+ إضافة كلمة أخرى" }));
    expect(screen.getByText("الكلمة ٢")).toBeInTheDocument();
  });

  it("adds and removes an additional example within a card", async () => {
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );
    await user.click(screen.getByRole("button", { name: "+ إضافة مثال" }));
    const removeButtons = screen.getAllByRole("button", { name: /حذف المثال/ });
    expect(removeButtons).toHaveLength(2);
    await user.click(removeButtons[1]);
    expect(
      screen.queryAllByRole("button", { name: /حذف المثال/ }),
    ).toHaveLength(0);
  });

  it("shows a validation error and does not submit when consent is missing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );

    await user.type(screen.getByLabelText(/الكلمة باللهجة/), "سبهللة");
    await user.type(screen.getByLabelText(/اللهجة أو المنطقة/), "حجازي");
    await user.type(screen.getByLabelText("مثال في جملة"), "راح يمشي سبهللة");

    await user.click(screen.getByRole("button", { name: "إرسال المساهمة" }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("submits successfully without a formal-Arabic synonym (now optional)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ batchId: "11111111-1111-1111-1111-111111111111" }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );

    await user.type(screen.getByLabelText(/الكلمة باللهجة/), "سبهللة");
    await user.type(screen.getByLabelText(/اللهجة أو المنطقة/), "حجازي");
    await user.type(screen.getByLabelText("مثال في جملة"), "راح يمشي سبهللة");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "إرسال المساهمة" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.words[0].msaSynonym).toBe("");
  });

  it("submits successfully (ordinary submission), clears the draft, and shows the success state — without advancing the prompt batch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ batchId: "11111111-1111-1111-1111-111111111111" }),
      }),
    );
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={page([ricePrompt])}
        initialDialectOptions={dialectOptions}
      />,
    );

    await user.type(screen.getByLabelText(/الكلمة باللهجة/), "سبهللة");
    await user.type(screen.getByLabelText(/اللهجة أو المنطقة/), "حجازي");
    await user.type(
      screen.getByLabelText(/المرادف بالعربية الفصحى/),
      "بلا هدف",
    );
    await user.type(screen.getByLabelText("مثال في جملة"), "راح يمشي سبهللة");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "إرسال المساهمة" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "وصلتنا مساهمتك، شكرًا لك!" }),
      ).toBeInTheDocument();
    });
    expect(
      window.localStorage.getItem("lahajat.contribution.draft.v1"),
    ).toBeNull();

    // Ordinary (non-guided) submission must not fetch another batch.
    expect(listReferencePromptsPageMock).not.toHaveBeenCalled();
    expect(screen.getByText("أرز")).toBeInTheDocument();
  });

  it("restores an unfinished draft after remount", async () => {
    const { unmount } = render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/الكلمة باللهجة/), "مسودة");
    unmount();

    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue("مسودة")).toBeInTheDocument();
    });
    expect(screen.getByText(/تمت استعادة مسودة محفوظة/)).toBeInTheDocument();
  });

  it("shows a distinct retry state when the initial guided-prompt load failed (server error, not genuine empty)", () => {
    render(
      <ContributionForm
        initialPrompts={null}
        initialDialectOptions={dialectOptions}
      />,
    );
    expect(
      screen.getByText(
        "تعذّر تحميل الاقتراحات الآن. يمكنك إضافة كلمتك مباشرة في الأسفل.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "لا توجد اقتراحات متاحة الآن. يمكنك إضافة كلمتك مباشرة في الأسفل.",
      ),
    ).not.toBeInTheDocument();
  });

  it("retrying after a failed guided-prompt load refetches and clears the error state", async () => {
    listReferencePromptsPageMock.mockResolvedValue(page([ricePrompt], 300));
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={null}
        initialDialectOptions={dialectOptions}
      />,
    );
    await user.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(screen.getByText("أرز")).toBeInTheDocument());
  });

  it("shows the batch range indicator and lets a visitor request the next batch", async () => {
    listReferencePromptsPageMock.mockResolvedValueOnce(
      page([{ ...ricePrompt, id: "next-prompt", msaLemma: "قمح" }], 300),
    );
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={page([ricePrompt], 300)}
        initialDialectOptions={dialectOptions}
      />,
    );
    expect(screen.getByText("١–١ من ٣٠٠")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "الكلمات التالية" }));
    await waitFor(() => expect(screen.getByText("قمح")).toBeInTheDocument());
    expect(listReferencePromptsPageMock).toHaveBeenCalledWith({
      offset: 6,
      limit: 6,
    });
  });
});

describe("ContributionForm dialect combobox", () => {
  it("lets a visitor pick a main dialect group from the pinned list", async () => {
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );
    const dialectInput = screen.getByLabelText(/اللهجة أو المنطقة/);
    await user.click(dialectInput);
    await user.click(screen.getByRole("option", { name: "حجازي" }));
    expect(dialectInput).toHaveValue("حجازي");
  });

  it("lets a visitor pick an existing local dialect", async () => {
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );
    const dialectInput = screen.getByLabelText(/اللهجة أو المنطقة/);
    await user.type(dialectInput, "جدا");
    await user.click(screen.getByRole("option", { name: "جداوي" }));
    expect(dialectInput).toHaveValue("جداوي");
  });

  it("offers to use a typed value as a new local dialect when it isn't listed", async () => {
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );
    const dialectInput = screen.getByLabelText(/اللهجة أو المنطقة/);
    await user.type(dialectInput, "لهجتي الخاصة");
    expect(
      screen.getByRole("option", {
        name: "استخدام «لهجتي الخاصة» كاسم لهجة جديدة",
      }),
    ).toBeInTheDocument();
  });
});

describe("ContributionForm guided contribution", () => {
  it("displays the initial guided prompts near the top of the page", () => {
    render(
      <ContributionForm
        initialPrompts={page([ricePrompt])}
        initialDialectOptions={dialectOptions}
      />,
    );
    expect(screen.getByText("أرز")).toBeInTheDocument();
  });

  it("choosing a prompt adds a card that prefills the synonym and meaning as read-only", async () => {
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={page([ricePrompt])}
        initialDialectOptions={dialectOptions}
      />,
    );

    await user.click(screen.getByRole("button", { name: /أرز/ }));

    // Only the pre-existing ordinary card has an editable synonym input; the
    // new guided card renders its synonym/meaning as read-only text instead.
    expect(screen.getAllByLabelText(/المرادف بالعربية الفصحى/)).toHaveLength(1);
    const synonymTexts = screen.getAllByText("أرز");
    expect(synonymTexts.length).toBeGreaterThan(0);

    // Dialect word and dialect fields are present, empty, and editable.
    const wordInputs = screen.getAllByLabelText(/الكلمة باللهجة/);
    const guidedWordInput = wordInputs[
      wordInputs.length - 1
    ] as HTMLInputElement;
    expect(guidedWordInput.value).toBe("");
  });

  it("the prompt id and a snapshot reach the submitted payload, retaining the prefilled reference synonym, and a guided submission advances to the next batch", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ batchId: "11111111-1111-1111-1111-111111111111" }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    listReferencePromptsPageMock.mockResolvedValueOnce(page([], 300));
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={page([ricePrompt], 300)}
        initialDialectOptions={dialectOptions}
      />,
    );

    await user.click(screen.getByRole("button", { name: /أرز/ }));
    // Remove the original empty ordinary card so only the guided card needs
    // filling in this scenario.
    await user.click(screen.getByRole("button", { name: "حذف الكلمة ١" }));

    await user.type(screen.getByLabelText(/الكلمة باللهجة/), "عيش");
    await user.type(screen.getByLabelText(/اللهجة أو المنطقة/), "جداوي");
    await user.type(
      screen.getByLabelText("مثال في جملة"),
      "جبت العيش من الفرن",
    );
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "إرسال المساهمة" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.words[0].referencePromptId).toBe("rice");
    expect(body.words[0].referencePromptSnapshot.msaLemma).toBe("أرز");
    expect(body.words[0].referencePromptSnapshot.promptVersion).toBe(1);
    expect(body.words[0].msaSynonym).toBe("أرز");

    // Guided submission advances the ordered batch position.
    await waitFor(() =>
      expect(listReferencePromptsPageMock).toHaveBeenCalledWith({
        offset: 6,
        limit: 6,
      }),
    );
  });

  it("ordinary submissions still send no reference prompt fields", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ batchId: "11111111-1111-1111-1111-111111111111" }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );

    await user.type(screen.getByLabelText(/الكلمة باللهجة/), "سبهللة");
    await user.type(screen.getByLabelText(/اللهجة أو المنطقة/), "حجازي");
    await user.type(
      screen.getByLabelText(/المرادف بالعربية الفصحى/),
      "بلا هدف",
    );
    await user.type(screen.getByLabelText("مثال في جملة"), "راح يمشي سبهللة");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "إرسال المساهمة" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.words[0].referencePromptId).toBeNull();
    expect(body.words[0].referencePromptSnapshot).toBeNull();
    // idempotency key is still a stable uuid sent with the request.
    expect(body.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe("ContributionForm Turnstile gating", () => {
  it("disables submit while Turnstile has not yet produced a token", () => {
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
        turnstileSiteKey="test-site-key"
      />,
    );
    expect(
      screen.getByRole("button", { name: "إرسال المساهمة" }),
    ).toBeDisabled();
  });
});

describe("ContributionForm ?dialect= preselection", () => {
  it("preselects a valid main-group code into the first card's dialect field, using the trusted existing dialect row", () => {
    mockSearchParams = new URLSearchParams("dialect=hijazi");
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );
    expect(screen.getByLabelText(/اللهجة أو المنطقة/)).toHaveValue("حجازي");
    // A trusted main-group id was resolved, so this renders as a normal
    // selection — no "تتبع أي مجموعة رئيسية؟" custom-dialect fallback.
    expect(
      screen.queryByLabelText("تتبع أي مجموعة رئيسية؟"),
    ).not.toBeInTheDocument();
  });

  it("ignores an invalid dialect query parameter (not one of the five group codes)", () => {
    mockSearchParams = new URLSearchParams("dialect=DROP TABLE dialects");
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );
    expect(screen.getByLabelText(/اللهجة أو المنطقة/)).toHaveValue("");
  });

  it("ignores a syntactically-valid-looking but unlisted code, and a raw database id", () => {
    mockSearchParams = new URLSearchParams(
      "dialect=11111111-1111-4111-8111-111111111111",
    );
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );
    expect(screen.getByLabelText(/اللهجة أو المنطقة/)).toHaveValue("");
  });

  it("leaves the prefilled dialect editable — the visitor can clear it or type a different one", async () => {
    mockSearchParams = new URLSearchParams("dialect=hijazi");
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );
    const dialectInput = screen.getByLabelText(/اللهجة أو المنطقة/);
    expect(dialectInput).toHaveValue("حجازي");
    expect(dialectInput).not.toHaveAttribute("readonly");
    expect(dialectInput).not.toBeDisabled();
    await user.clear(dialectInput);
    await user.type(dialectInput, "لهجة أخرى غير مدرجة");
    expect(dialectInput).toHaveValue("لهجة أخرى غير مدرجة");
  });

  it("a draft with an empty dialect receives the prefill immediately", () => {
    window.localStorage.setItem(
      "lahajat.contribution.draft.v1",
      JSON.stringify({
        words: [
          {
            clientId: "w1",
            word: "كلمة محفوظة",
            dialect: "",
            dialectId: null,
            provisionalMainGroupCode: null,
            msaSynonym: "",
            explanation: "",
            examples: [{ sentence: "" }],
            referencePromptId: null,
            referencePromptSnapshot: null,
          },
        ],
        consent: false,
      }),
    );
    mockSearchParams = new URLSearchParams("dialect=hijazi");
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );
    expect(screen.getByLabelText(/اللهجة أو المنطقة/)).toHaveValue("حجازي");
    // The rest of the restored draft is untouched.
    expect(screen.getByLabelText(/الكلمة باللهجة/)).toHaveValue("كلمة محفوظة");
  });

  it("a draft that already has the same dialect is left unchanged, with no confirmation prompt", () => {
    window.localStorage.setItem(
      "lahajat.contribution.draft.v1",
      JSON.stringify({
        words: [
          {
            clientId: "w1",
            word: "",
            dialect: "حجازي",
            dialectId: "11111111-1111-4111-8111-111111111111",
            provisionalMainGroupCode: null,
            msaSynonym: "",
            explanation: "",
            examples: [{ sentence: "" }],
            referencePromptId: null,
            referencePromptSnapshot: null,
          },
        ],
        consent: false,
      }),
    );
    mockSearchParams = new URLSearchParams("dialect=hijazi");
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );
    expect(screen.getByLabelText(/اللهجة أو المنطقة/)).toHaveValue("حجازي");
    expect(screen.queryByText(/اخترت دعم اللهجة/)).not.toBeInTheDocument();
  });

  it("a draft with a different dialect is preserved and offered as a choice instead of being overwritten", async () => {
    window.localStorage.setItem(
      "lahajat.contribution.draft.v1",
      JSON.stringify({
        words: [
          {
            clientId: "w1",
            word: "كلمة نجدية",
            dialect: "نجدي",
            dialectId: "22222222-2222-4222-8222-222222222222",
            provisionalMainGroupCode: null,
            msaSynonym: "مرادف محفوظ",
            explanation: "",
            examples: [{ sentence: "مثال محفوظ" }],
            referencePromptId: null,
            referencePromptSnapshot: null,
          },
        ],
        consent: true,
      }),
    );
    mockSearchParams = new URLSearchParams("dialect=hijazi");
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );

    // Not overwritten yet, and every other draft field survives untouched.
    expect(screen.getByLabelText(/اللهجة أو المنطقة/)).toHaveValue("نجدي");
    expect(screen.getByLabelText(/الكلمة باللهجة/)).toHaveValue("كلمة نجدية");
    expect(
      screen.getByText("اخترت دعم اللهجة الحجازية من لوحة اللهجات."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "استخدام حجازي" }));
    expect(screen.getByLabelText(/اللهجة أو المنطقة/)).toHaveValue("حجازي");
    // Confirming the switch still doesn't touch the rest of the draft.
    expect(screen.getByLabelText(/الكلمة باللهجة/)).toHaveValue("كلمة نجدية");
    expect(screen.queryByText(/اخترت دعم اللهجة/)).not.toBeInTheDocument();
  });

  it("choosing to keep the current dialect dismisses the prompt and leaves the draft untouched", async () => {
    window.localStorage.setItem(
      "lahajat.contribution.draft.v1",
      JSON.stringify({
        words: [
          {
            clientId: "w1",
            word: "",
            dialect: "نجدي",
            dialectId: "22222222-2222-4222-8222-222222222222",
            provisionalMainGroupCode: null,
            msaSynonym: "",
            explanation: "",
            examples: [{ sentence: "" }],
            referencePromptId: null,
            referencePromptSnapshot: null,
          },
        ],
        consent: false,
      }),
    );
    mockSearchParams = new URLSearchParams("dialect=hijazi");
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "الاحتفاظ باللهجة الحالية" }),
    );
    expect(screen.getByLabelText(/اللهجة أو المنطقة/)).toHaveValue("نجدي");
    expect(screen.queryByText(/اخترت دعم اللهجة/)).not.toBeInTheDocument();
  });

  it("consumes the query prefill once — a later rerender does not reset a dialect the visitor changed by hand", async () => {
    mockSearchParams = new URLSearchParams("dialect=hijazi");
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );
    const dialectInput = screen.getByLabelText(/اللهجة أو المنطقة/);
    expect(dialectInput).toHaveValue("حجازي");

    fireEvent.change(dialectInput, { target: { value: "جداوي" } });
    // Any state change elsewhere re-renders the tree; the already-consumed
    // ?dialect= must not reapply and wipe out the hand-typed value.
    await user.type(screen.getByLabelText(/الكلمة باللهجة/), "كلمة");
    expect(dialectInput).toHaveValue("جداوي");
  });

  it("does not submit anything automatically as part of prefilling", () => {
    const fetchSpy = vi.spyOn(window, "fetch");
    mockSearchParams = new URLSearchParams("dialect=hijazi");
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("ContributionForm #contribute focus", () => {
  it("moves focus to the contribution section when the hash is already present on mount", () => {
    window.location.hash = "#contribute";
    render(
      <ContributionForm
        initialPrompts={page([])}
        initialDialectOptions={dialectOptions}
      />,
    );
    expect(document.getElementById("contribute")).toHaveFocus();
  });
});
