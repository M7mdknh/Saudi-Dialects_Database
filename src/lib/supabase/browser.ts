import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "./types";

/** Browser client for admin sign-in only (RLS applies; anon key). */
export function createSupabaseBrowserClient() {
  const env = getPublicEnv();
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
