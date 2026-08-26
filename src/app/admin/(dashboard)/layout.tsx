import Link from "next/link";
import { SignOutButton } from "@/features/review/SignOutButton";
import { getDuplicateSummary } from "@/features/duplicates/actions";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Best-effort badge count: a transient data failure here must never block
  // the whole admin area from rendering. A redirect from requireAdmin()
  // (unauthenticated/non-admin) must NOT be swallowed here though — every
  // page under this layout also calls requireAdmin() itself and will
  // redirect properly regardless, but re-throwing keeps this from masking
  // that signal or logging a spurious caught-redirect warning.
  const unresolvedCount = await getDuplicateSummary()
    .then((s) => s.unresolvedGroups)
    .catch((error: unknown) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "digest" in error &&
        typeof error.digest === "string" &&
        error.digest.startsWith("NEXT_REDIRECT")
      ) {
        throw error;
      }
      return null;
    });

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border bg-surface flex items-center justify-between border-b px-4 py-3 sm:px-6">
        <Link href="/admin" className="text-base font-bold">
          لوحة مراجعة لهجات
        </Link>
        <nav className="flex items-center gap-3">
          <Link
            href="/admin/duplicates"
            className="flex items-center gap-1 text-sm font-semibold hover:underline"
          >
            التكرارات
            {unresolvedCount ? (
              <span className="bg-accent text-accent-foreground rounded-full px-1.5 py-0.5 text-xs font-bold">
                {unresolvedCount}
              </span>
            ) : null}
          </Link>
          <Link
            href="/admin/dictionary"
            className="text-sm font-semibold hover:underline"
          >
            القاموس
          </Link>
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
