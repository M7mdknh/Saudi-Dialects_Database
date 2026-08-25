import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-border bg-surface border-t">
      <div className="max-w-shell mx-auto flex w-full flex-col items-center gap-2 px-4 py-6 text-center sm:px-6">
        <p className="text-foreground text-sm font-semibold">
          قاموس اللهجات السعودية
        </p>
        <p className="text-foreground/60 max-w-reading text-xs">
          منصّة مفتوحة لجمع كلمات اللهجات السعودية من المساهمين، ومراجعتها،
          وتوثيقها ضمن مجموعة بيانات تحترم تنوّع لهجات المملكة.
        </p>
        <nav
          aria-label="روابط الفوتر"
          className="flex flex-wrap justify-center gap-4 pt-1"
        >
          <Link
            href="/prompts"
            className="text-foreground/70 hover:text-accent min-h-11 items-center px-1 text-xs font-semibold"
          >
            تحدّي الكلمات
          </Link>
          <Link
            href="/leaderboard"
            className="text-foreground/70 hover:text-accent min-h-11 items-center px-1 text-xs font-semibold"
          >
            لوحة اللهجات
          </Link>
        </nav>
      </div>
    </footer>
  );
}
