"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV_LINKS = [
  { href: "/", label: "الرئيسية" },
  { href: "/#contribute", label: "ساهم بكلمة" },
  { href: "/prompts", label: "تحدّي الكلمات" },
  { href: "/leaderboard", label: "لوحة اللهجات" },
];

function isActive(pathname: string, href: string): boolean {
  // A hash link (e.g. "/#contribute") is an in-page action, not a distinct
  // destination page, so it never claims the "current page" state — only
  // الرئيسية should be active for "/".
  if (href.includes("#")) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="border-border bg-surface border-b">
      <div className="max-w-shell mx-auto flex w-full items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="text-foreground shrink-0 text-base font-bold">
          قاموس اللهجات السعودية
        </Link>

        <nav aria-label="التنقّل الرئيسي" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV_LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold transition-colors ${
                      active
                        ? "text-accent bg-accent/10"
                        : "text-foreground/80 hover:text-foreground hover:bg-surface-muted"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <button
          type="button"
          className="border-border text-foreground flex min-h-11 min-w-11 items-center justify-center rounded-lg border md:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav-menu"
          aria-label={menuOpen ? "إغلاق القائمة" : "فتح القائمة"}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            {menuOpen ? (
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M3 5h14M3 10h14M3 15h14"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            )}
          </svg>
        </button>
      </div>

      {menuOpen ? (
        <nav
          id="mobile-nav-menu"
          aria-label="التنقّل الرئيسي (جوال)"
          className="border-border border-t md:hidden"
        >
          <ul className="max-w-shell mx-auto flex w-full flex-col px-4 py-2 sm:px-6">
            {NAV_LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                    className={`flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold ${
                      active ? "text-accent bg-accent/10" : "text-foreground/80"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
