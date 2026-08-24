import { z } from "zod";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  ABUSE_HASH_SECRET: z.string().min(1),
});

let cachedServerEnv: z.infer<typeof serverEnvSchema> | undefined;

/** Validates and returns server-only environment variables. Throws with a clear message if missing. */
export function getServerEnv() {
  if (cachedServerEnv) return cachedServerEnv;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Missing or invalid environment variables: ${parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
    );
  }
  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
});

export function getPublicEnv() {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  });
}
