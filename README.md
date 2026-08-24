# لهجات — Lahajat AI Dialect Collector

Crowdsources Arabic dialect words from anonymous contributors and turns them into a
reviewed, provenance-preserving dataset for Lahajat AI. See `CLAUDE.md` and
`.claude/skills/build-dialect-collector/` for the full product/data-model spec this
implementation follows.

- Public page (`/`): mobile-first Arabic RTL multi-word contribution form, no account required.
- Admin area (`/admin`): private review grid, classification, duplicate/merge workspace, and export.

## Stack

Next.js (App Router, TypeScript strict) · Tailwind CSS · Supabase (Postgres, Auth, RLS) ·
Zod · Vitest · Playwright · Cloudflare Turnstile.

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in real values, see below
npm run dev                  # http://localhost:3000
```

Without real Supabase credentials the app still builds, lints, type-checks, and runs its
unit tests, but any page or API route that talks to Supabase (the form's submit, all of
`/admin/*`) will fail at request time — see "Supabase setup" below to get a working
local backend.

### Scripts

```bash
npm run dev         # dev server
npm run build        # production build
npm run start         # run the production build
npm run lint          # eslint
npm run typecheck     # tsc --noEmit
npm run format         # prettier --write
npm run format:check   # prettier --check
npm run test           # vitest (unit/integration)
npm run test:watch     # vitest --watch
npm run test:e2e       # playwright (mobile + desktop journeys)
```

`npm run test:e2e` builds and starts the app itself (see `playwright.config.ts`); run
`npx playwright install chromium` once beforehand if browsers aren't installed yet.

## Environment variables

Copy `.env.example` to `.env.local` and fill in real values. Never commit real secrets.

| Variable | Where it's used | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Public anon key (RLS-restricted) |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Bypasses RLS — used only by the validated `/api/submissions` route. Never expose to the browser. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | client | Optional in local dev. If unset, the widget doesn't render and the server skips Turnstile verification (dev-only fallback — see `TURNSTILE_SECRET_KEY` below). |
| `TURNSTILE_SECRET_KEY` | server only | If set, the server *requires and verifies* a Turnstile token on every submission. Leave unset locally to skip verification. |
| `ABUSE_HASH_SECRET` | server only | HMAC key used to derive a short-lived hash of the requester IP for rate-limiting. Raw IPs are never stored. Generate with `openssl rand -hex 32`. |

## Supabase setup

1. Create a Supabase project (or run the local dev stack with the Supabase CLI:
   `supabase start`).
2. Apply the migrations in order:

   ```bash
   supabase link --project-ref <your-project-ref>   # or: supabase start (local)
   supabase db push                                  # applies supabase/migrations/*.sql
   ```

   Migrations, in order: `0001_extensions` → `0002_core_tables` → `0003_functions` →
   `0004_rls` → `0005_seed_dialects` → `0006_dashboard_helpers` →
   `0007_dialect_admin_functions` → `0008_classify_function` → `0009_export_log`.

3. (Optional but recommended) Regenerate TypeScript types from the deployed schema and
   replace the hand-maintained `src/lib/supabase/types.ts`:

   ```bash
   supabase gen types typescript --linked > src/lib/supabase/types.ts
   ```

   `types.ts` is currently hand-maintained and documents itself as a stand-in; the app's
   embedded-select queries (`select("*, raw_examples(*)")` etc.) are cast at the call
   site because this file doesn't model foreign-key relationships. Regenerating from a
   real project removes the need for those casts if you extend the relationships.

4. Create the first admin:

   ```sql
   -- After the user has signed up once via Supabase Auth (e.g. through the
   -- Supabase dashboard's "Add user" or your own sign-up flow — there is no
   -- public admin sign-up page by design):
   insert into admins (user_id, is_active)
   values ('<the auth.users.id of that user>', true);
   ```

   Only rows in `admins` with `is_active = true` can reach `/admin/*`; authentication
   alone is not authorization (see `src/lib/auth/require-admin.ts`).

## Turnstile setup

1. Create a Turnstile widget at the Cloudflare dashboard for your domain(s)
   (`localhost`, your Vercel preview domain, and your production domain).
2. Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`.
3. Once `TURNSTILE_SECRET_KEY` is set, the public submission endpoint requires and
   verifies a token server-side on every request (`src/features/contributions/turnstile-verify.ts`).

## Deployment (Vercel)

1. Push this repo to a Git provider and import it into Vercel.
2. Set all six environment variables above in the Vercel project (Preview and
   Production separately, since Turnstile hostnames typically differ).
3. Apply Supabase migrations against the target project as a deliberate release step
   (`supabase db push` against the linked project) before or as part of deploy.
4. Create the initial admin row (see above) against the target project.
5. Deploy. `next build` runs `next.config.ts`'s security headers automatically; no
   further Vercel-specific configuration is required.

This project does not deploy itself and does not create any paid service — that step is
left to you.

## Notes on scope

- The export field mapping (`src/features/exports/projection.ts`) is explicitly
  versioned and marked provisional: the earlier Lahajat AI training JSON schema wasn't
  available in this workspace, so the database model is kept independent of the export
  shape (see `references/data-model.md`).
- `src/lib/supabase/types.ts` is hand-maintained, not generated from a live database —
  see the Supabase setup section above.
- Playwright's `admin-access` journeys cover unauthenticated redirect/login-failure
  only, since exercising the full authenticated review/merge/export journeys requires a
  live Supabase project with a seeded admin user.
