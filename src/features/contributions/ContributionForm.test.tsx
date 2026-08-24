import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContributionForm } from "./ContributionForm";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ContributionForm", () => {
  it("renders one word card by default with the required fields", () => {
    render(<ContributionForm />);
    expect(
      screen.getByRole("heading", { name: "ساهم بكلمة من لهجتك" }),
    ).toBeInTheDocument();
    expect(screen.getByText("الكلمة ١")).toBeInTheDocument();
  });

  it("adds another word card when the add-word button is clicked", async () => {
    const user = userEvent.setup();
    render(<ContributionForm />);
    await user.click(screen.getByRole("button", { name: "+ إضافة كلمة أخرى" }));
    expect(screen.getByText("الكلمة ٢")).toBeInTheDocument();
  });

  it("adds and removes an additional example within a card", async () => {
    const user = userEvent.setup();
    render(<ContributionForm />);
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
    render(<ContributionForm />);

    await user.type(screen.getByLabelText(/الكلمة باللهجة/), "سبهللة");
    await user.type(screen.getByLabelText(/اللهجة أو المنطقة/), "حجازي");
    await user.type(
      screen.getByLabelText(/مرادفها بالعربية الفصحى/),
      "بلا هدف",
    );
    await user.type(screen.getByLabelText("مثال في جملة"), "راح يمشي سبهللة");

    await user.click(screen.getByRole("button", { name: "إرسال المساهمة" }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("submits successfully, clears the draft, and shows the success state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ batchId: "11111111-1111-1111-1111-111111111111" }),
      }),
    );
    const user = userEvent.setup();
    render(<ContributionForm />);

    await user.type(screen.getByLabelText(/الكلمة باللهجة/), "سبهللة");
    await user.type(screen.getByLabelText(/اللهجة أو المنطقة/), "حجازي");
    await user.type(
      screen.getByLabelText(/مرادفها بالعربية الفصحى/),
      "بلا هدف",
    );
    await user.type(screen.getByLabelText("مثال في جملة"), "راح يمشي سبهللة");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "إرسال المساهمة" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "تم إرسال مساهمتك بنجاح" }),
      ).toBeInTheDocument();
    });
    expect(
      window.localStorage.getItem("lahajat.contribution.draft.v1"),
    ).toBeNull();
  });

  it("restores an unfinished draft after remount", async () => {
    const { unmount } = render(<ContributionForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/الكلمة باللهجة/), "مسودة");
    unmount();

    render(<ContributionForm />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("مسودة")).toBeInTheDocument();
    });
    expect(screen.getByText(/تمت استعادة مسودة محفوظة/)).toBeInTheDocument();
  });
});
