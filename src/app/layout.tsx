import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="ar" dir="rtl" className="h-full antialiased">
      <body className="bg-background text-foreground flex min-h-full flex-col">
        {children}
      </body>
    </html>
  );
}
