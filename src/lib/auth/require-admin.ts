import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AdminSession {
  userId: string;
  email: string | null;
}

/** Redirects to login (no session) or access-denied (authenticated, not an active admin). */
export async function requireAdmin(): Promise<AdminSession> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  const { data: adminRow } = await supabase
    .from("admins")
    .select("user_id, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!adminRow || !adminRow.is_active) {
    redirect("/admin/access-denied");
  }

  return { userId: user.id, email: user.email ?? null };
}
