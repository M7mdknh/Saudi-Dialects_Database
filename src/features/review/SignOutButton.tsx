"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/Button";

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={async () => {
        const supabase = createSupabaseBrowserClient();
        await supabase.auth.signOut();
        router.push("/admin/login");
        router.refresh();
      }}
    >
      تسجيل الخروج
    </Button>
  );
}
