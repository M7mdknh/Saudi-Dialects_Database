import type { Metadata } from "next";
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
        {children}
      </body>
    </html>
  );
}
