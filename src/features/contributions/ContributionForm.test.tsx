import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GuidedPromptRecord } from "@/features/prompts/types";
import type { PublicDialectOption } from "./dialects-actions";

const getGuidedPromptsMock = vi.fn();
vi.mock("@/features/prompts/actions", () => ({
  getGuidedPrompts: (...args: unknown[]) => getGuidedPromptsMock(...args),
}));

const listPublicDialectsMock = vi.fn();
vi.mock("./dialects-actions", () => ({
  listPublicDialects: (...args: unknown[]) => listPublicDialectsMock(...args),
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

const dialectOptions: PublicDialectOption[] = [
  {
    id: "d-hijazi",
    nameAr: "حجازي",
    slug: "hijazi-main",
    parentId: null,
    mainGroupCode: "hijazi",
  },
  {
    id: "d-najdi",
    nameAr: "نجدي",
    slug: "najdi-main",
    parentId: null,
    mainGroupCode: "najdi",
  },
  {
    id: "d-jeddawi",
    nameAr: "جداوي",
    slug: "jeddawi",
    parentId: "d-hijazi",
    mainGroupCode: "hijazi",
  },
];

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  getGuidedPromptsMock.mockReset();
  getGuidedPromptsMock.mockResolvedValue([]);
  listPublicDialectsMock.mockReset();
  listPublicDialectsMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ContributionForm", () => {
  it("renders one word card by default with the required fields", () => {
    render(<ContributionForm initialPrompts={[]} initialDialectOptions={[]} />);
    expect(
      screen.getByRole("heading", { name: "ساهم بكلمة من لهجتك" }),
    ).toBeInTheDocument();
    expect(screen.getByText("الكلمة ١")).toBeInTheDocument();
  });

  it("adds another word card when the add-word button is clicked", async () => {
    const user = userEvent.setup();
    render(<ContributionForm initialPrompts={[]} initialDialectOptions={[]} />);
    await user.click(screen.getByRole("button", { name: "+ إضافة كلمة أخرى" }));
    expect(screen.getByText("الكلمة ٢")).toBeInTheDocument();
  });

  it("adds and removes an additional example within a card", async () => {
    const user = userEvent.setup();
    render(<ContributionForm initialPrompts={[]} initialDialectOptions={[]} />);
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
    render(<ContributionForm initialPrompts={[]} initialDialectOptions={[]} />);

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
    render(<ContributionForm initialPrompts={[]} initialDialectOptions={[]} />);

    await user.type(screen.getByLabelText(/الكلمة باللهجة/), "سبهللة");
    await user.type(screen.getByLabelText(/اللهجة أو المنطقة/), "حجازي");
    await user.type(screen.getByLabelText("مثال في جملة"), "راح يمشي سبهللة");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "إرسال المساهمة" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.words[0].msaSynonym).toBe("");
  });

  it("submits successfully (ordinary submission), clears the draft, refreshes prompts, and shows the success state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ batchId: "11111111-1111-1111-1111-111111111111" }),
      }),
    );
    getGuidedPromptsMock.mockResolvedValue([ricePrompt]);
    const user = userEvent.setup();
    render(<ContributionForm initialPrompts={[]} initialDialectOptions={[]} />);

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
        screen.getByRole("heading", { name: "وصلتنا مساهمتك، وشكراً لك!" }),
      ).toBeInTheDocument();
    });
    expect(
      window.localStorage.getItem("lahajat.contribution.draft.v1"),
    ).toBeNull();

    await waitFor(() => {
      expect(getGuidedPromptsMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText("أرز")).toBeInTheDocument();
    });
  });

  it("restores an unfinished draft after remount", async () => {
    const { unmount } = render(
      <ContributionForm initialPrompts={[]} initialDialectOptions={[]} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/الكلمة باللهجة/), "مسودة");
    unmount();

    render(<ContributionForm initialPrompts={[]} initialDialectOptions={[]} />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("مسودة")).toBeInTheDocument();
    });
    expect(screen.getByText(/تمت استعادة مسودة محفوظة/)).toBeInTheDocument();
  });

  it("shows a distinct retry state when the initial guided-prompt load failed (server error, not genuine empty)", () => {
    render(
      <ContributionForm initialPrompts={null} initialDialectOptions={[]} />,
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
    getGuidedPromptsMock.mockResolvedValue([ricePrompt]);
    const user = userEvent.setup();
    render(
      <ContributionForm initialPrompts={null} initialDialectOptions={[]} />,
    );
    await user.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(screen.getByText("أرز")).toBeInTheDocument());
  });
});

describe("ContributionForm dialect combobox", () => {
  it("lets a visitor pick a main dialect group from the pinned list", async () => {
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={[]}
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
        initialPrompts={[]}
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
        initialPrompts={[]}
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
        initialPrompts={[ricePrompt]}
        initialDialectOptions={[]}
      />,
    );
    expect(screen.getByText("أرز")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "أعرف كلمة لهذا المعنى" }),
    ).toBeInTheDocument();
  });

  it("choosing a prompt adds a card that prefills the synonym and meaning as read-only", async () => {
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={[ricePrompt]}
        initialDialectOptions={[]}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "أعرف كلمة لهذا المعنى" }),
    );

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

  it("the prompt id and a snapshot reach the submitted payload, retaining the prefilled reference synonym", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ batchId: "11111111-1111-1111-1111-111111111111" }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    render(
      <ContributionForm
        initialPrompts={[ricePrompt]}
        initialDialectOptions={[]}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "أعرف كلمة لهذا المعنى" }),
    );
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
  });

  it("ordinary submissions still send no reference prompt fields", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ batchId: "11111111-1111-1111-1111-111111111111" }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    render(<ContributionForm initialPrompts={[]} initialDialectOptions={[]} />);

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
        initialPrompts={[]}
        initialDialectOptions={[]}
        turnstileSiteKey="test-site-key"
      />,
    );
    expect(
      screen.getByRole("button", { name: "إرسال المساهمة" }),
    ).toBeDisabled();
  });
});
