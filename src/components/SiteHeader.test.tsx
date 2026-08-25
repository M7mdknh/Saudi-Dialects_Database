import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

const { SiteHeader } = await import("./SiteHeader");

describe("SiteHeader primary navigation", () => {
  it("does not include a separate 'ساهم بكلمة' destination", () => {
    render(<SiteHeader />);
    expect(
      screen.queryByRole("link", { name: "ساهم بكلمة" }),
    ).not.toBeInTheDocument();
  });

  it("exposes exactly three primary destinations, each with a unique route", () => {
    render(<SiteHeader />);
    const nav = screen.getByRole("navigation", { name: "التنقّل الرئيسي" });
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual(["/", "/prompts", "/leaderboard"]);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("marks only the homepage link active when on the exact homepage", () => {
    render(<SiteHeader />);
    const nav = screen.getByRole("navigation", { name: "التنقّل الرئيسي" });
    expect(nav.querySelector('a[href="/"]')?.getAttribute("aria-current")).toBe(
      "page",
    );
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
