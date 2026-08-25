import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

// Self-hosted at build time by next/font (no runtime dependency on a font
// CDN); globals.css falls back to a robust Arabic system-font stack if this
// ever fails to load.
const ibmPlexSansArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  title: "لهجات — ساهم بكلمة من لهجتك",
  description:
    "منصة لهجات لجمع كلمات اللهجات العربية من المساهمين وبناء بيانات تدريب تحترم تنوّع لهجاتنا.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`h-full antialiased ${ibmPlexSansArabic.variable}`}
    >
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <header className="border-border bg-surface border-b">
          <nav
            aria-label="التنقّل الرئيسي"
            className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-4 py-3 sm:px-6"
          >
            <Link href="/" className="text-foreground text-base font-bold">
              لهجات
            </Link>
            <Link
              href="/leaderboard"
              className="text-foreground/80 hover:text-foreground flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold"
            >
              لوحة الصدارة
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
