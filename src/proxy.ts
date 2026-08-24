import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });
  const env = getPublicEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Refresh the session cookie on every request under /admin so server
  // components always see a current session.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};
