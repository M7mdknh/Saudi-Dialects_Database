import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import type { Database } from "./types";

/**
 * Service-role client. Bypasses RLS entirely — never import this from client
 * code and never use it to serve arbitrary public-facing reads. Restricted to
 * the validated submission endpoint and admin server actions that have
 * already authorized the caller.
 */
export function createSupabaseAdminClient() {
  const env = getServerEnv();
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
