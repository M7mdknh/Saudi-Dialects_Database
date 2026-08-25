import Link from "next/link";
import { SignOutButton } from "@/features/review/SignOutButton";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border bg-surface flex items-center justify-between border-b px-4 py-3 sm:px-6">
        <Link href="/admin" className="text-base font-bold">
          لوحة مراجعة لهجات
        </Link>
        <nav className="flex items-center gap-3">
          <Link
            href="/admin/prompts"
            className="text-sm font-semibold hover:underline"
          >
            المعاني المقترحة
          </Link>
          <Link
            href="/admin/exports"
            className="text-sm font-semibold hover:underline"
          >
            التصدير
          </Link>
          <SignOutButton />
        </nav>
      </header>
      <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
