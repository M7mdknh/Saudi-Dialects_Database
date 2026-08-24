import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "./types";

/** Server component / route handler client bound to the current user's session (RLS applies). */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component without a mutable response;
            // middleware refreshes the session in that case.
          }
        },
      },
    },
  );
}
