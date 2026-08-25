import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

const { SiteHeader } = await import("./SiteHeader");

describe("SiteHeader primary navigation", () => {
  it("shows 'ساهم بكلمة' as the homepage nav item", () => {
    render(<SiteHeader />);
    expect(
      screen.getByRole("link", { name: "ساهم بكلمة" }),
    ).toBeInTheDocument();
  });

  it("no longer shows a separate 'الرئيسية' item", () => {
    render(<SiteHeader />);
    expect(
      screen.queryByRole("link", { name: "الرئيسية" }),
    ).not.toBeInTheDocument();
  });

  it("exposes exactly three primary destinations, each with a unique route", () => {
    render(<SiteHeader />);
    const nav = screen.getByRole("navigation", { name: "التنقّل الرئيسي" });
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual(["/#contribute", "/prompts", "/leaderboard"]);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("marks the 'ساهم بكلمة' link active when on the exact homepage", () => {
    render(<SiteHeader />);
    const nav = screen.getByRole("navigation", { name: "التنقّل الرئيسي" });
    expect(
      screen
        .getByRole("link", { name: "ساهم بكلمة" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      nav.querySelector('a[href="/prompts"]')?.getAttribute("aria-current"),
    ).toBeNull();
  });

  it("the brand name links to the homepage", () => {
    render(<SiteHeader />);
    expect(
      screen.getByRole("link", { name: "قاموس اللهجات السعودية" }),
    ).toHaveAttribute("href", "/");
  });
});
