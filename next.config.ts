import type { NextConfig } from "next";

// The browser client (src/lib/supabase/browser.ts) talks to Supabase
// directly from the client, so connect-src must allow whatever origin is
// actually configured — not just the hosted https://*.supabase.co domain.
// Deriving it from the real env var (rather than hardcoding) means a local
// dev/E2E stack (http://127.0.0.1:54321) and a self-hosted Supabase project
// both work automatically, while production — where this var is the real
// hosted URL — sees no behavior change at all.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseConnectSrc = supabaseUrl
  ? new URL(supabaseUrl).origin
  : "https://*.supabase.co";

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${supabaseConnectSrc} https://challenges.cloudflare.com`,
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
