# لهجات — Lahajat AI Dialect Collector (Saudi Dialects Database)

Crowdsources Saudi Arabic dialect words from anonymous contributors — either freely, or
guided by a bank of 300 reference concepts — and turns them into a reviewed,
provenance-preserving dataset. See `CLAUDE.md` and
`.claude/skills/build-dialect-collector/` for the full product/data-model spec this
implementation follows.

- **Public page** (`/`): mobile-first Arabic RTL contribution form with two paths —
  guided ("وش تسمّون هذا بلهجتكم؟", six rotating reference prompts) and ordinary
  ("أضف كلمة بنفسك"). No account required.
- **Public leaderboard** (`/leaderboard`): ranks the five main Saudi dialect groups
  (حجازي، نجدي، شرقاوي، شمالي، جنوبي) by approved, unique canonical word count.
- **Public dialect explorer** (`/dialects/[slug]`): search/filter/sort/paginate a main
  group's approved words, slug is one of `hijazi | najdi | eastern | northern | southern`.
- **Admin area** (`/admin`): private review grid, classification, duplicate/merge
  workspace, prompt management (`/admin/prompts`), and export.

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
unit tests, but any page or API route that talks to Supabase (the form's submit, the
leaderboard/explorer, all of `/admin/*`) will fail at request time — see "Supabase
setup" below to get a working local backend.

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

npm run data:guided-prompts:check   # validate the authoritative dataset (see below)
npm run data:guided-prompts:build   # rebuild it from base+catalog (only if you have the base seed file)
npm run data:guided-prompts:seed    # regenerate the reference_prompts seed migration
```

`npm run test:e2e` builds and starts the app itself (see `playwright.config.ts`); run
`npx playwright install chromium` once beforehand if browsers aren't installed yet.

## Guided-prompt dataset workflow

`data/guided-prompts.sa.ar.json` is the **authoritative, version-controlled** source for
the 300 guided-contribution prompts (Arabic concept, definition, elicitation scenario,
category, priority). `data/guided-prompts.sa.catalog.json` is the Saudi-expansion
catalog it was assembled from; `data/guided-prompts-sources.md` documents the sources
and elicitation method. **The full JSON file is never shipped to the browser** — it's
read only on the server (by `scripts/generate-reference-prompts-seed.mjs` at dev time,
and by `list_active_reference_prompts()` at request time), and the public page only ever
receives the six prompts chosen for the current visitor.

- **Validate the dataset**: `npm run data:guided-prompts:check` — fails clearly (exit
  code 1, one message per problem) on duplicate stable IDs, missing required fields,
  invalid/unknown categories, malformed Arabic content (no Arabic characters, mojibake,
  raw markup), a prompt count other than exactly 300, or the dataset drifting out of
  sync with the catalog source. Run this in CI before merging any dataset change.
- **Editing the dataset**: edit `data/guided-prompts.sa.catalog.json` (or, if the
  original 96-prompt base file `data/guided-prompts.ar.json` is present, edit that too),
  then run `npm run data:guided-prompts:build` to regenerate
  `data/guided-prompts.sa.ar.json` deterministically — it re-validates before writing.
  If the base file isn't present in your checkout, `build` degrades to `check`
  (validates the already-committed authoritative file in place) rather than failing.
- **Regenerating the seed migration**: after any dataset change, run
  `npm run data:guided-prompts:seed` to regenerate
  `supabase/migrations/0015_seed_reference_prompts.sql` from the authoritative JSON
  (sorted by stable id for a stable diff), then commit the regenerated `.sql` file and
  apply it like any other migration. The seed is idempotent
  (`insert ... on conflict (id) do nothing`): rerunning it never duplicates a prompt and
  never overwrites a prompt an admin has since edited (admin edits go through
  `upsert_reference_prompt()`, which bumps `prompt_version` — a stable id is never
  reused for different content).

## Supabase setup

1. Create a Supabase project (or run the local dev stack with the Supabase CLI:
   `supabase start`).
2. Apply the migrations in order (all in `supabase/migrations/`, numbered):

   ```bash
   supabase link --project-ref <your-project-ref>   # or: supabase start (local)
   supabase db push                                  # applies supabase/migrations/*.sql
   ```

   `0001_extensions` → `0002_core_tables` → `0003_functions` → `0004_rls` →
   `0005_seed_dialects` → `0006_dashboard_helpers` → `0007_dialect_admin_functions` →
   `0008_classify_function` → `0009_export_log` → `0010_reference_prompts` →
   `0011_prompt_linkage` → `0012_saudi_classification` → `0013_public_functions` →
   `0014_prompt_admin_functions` → `0015_seed_reference_prompts` (generated, see above).

3. (Optional but recommended) Regenerate TypeScript types from the deployed schema and
   replace the hand-maintained `src/lib/supabase/types.ts`:

   ```bash
   supabase gen types typescript --linked > src/lib/supabase/types.ts
   ```

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

## Environment variables

Copy `.env.example` to `.env.local` and fill in real values. Never commit real secrets.
**No new required environment variables were introduced by this upgrade** — the same six
variables as before cover guided prompts, the leaderboard, and the explorer, since all of
it is reached through the existing Supabase URL/keys.

| Variable                         | Where it's used | Notes                                                                                                                                                          |
| -------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`       | client + server | Project URL                                                                                                                                                    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | client + server | Public anon key (RLS-restricted)                                                                                                                               |
| `SUPABASE_SERVICE_ROLE_KEY`      | server only     | Bypasses RLS — used only by the validated `/api/submissions` route. Never expose to the browser.                                                               |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | client          | Optional in local dev. If unset, the widget doesn't render and the server skips Turnstile verification (dev-only fallback — see `TURNSTILE_SECRET_KEY` below). |
| `TURNSTILE_SECRET_KEY`           | server only     | If set, the server _requires and verifies_ a Turnstile token on every submission. Leave unset locally to skip verification.                                    |
| `ABUSE_HASH_SECRET`              | server only     | HMAC key used to derive a short-lived hash of the requester IP for rate-limiting. Raw IPs are never stored. Generate with `openssl rand -hex 32`.              |

## Saudi classification and the leaderboard

- `dialects.main_group_code` is a stable internal code, one of `hijazi | najdi | eastern
| northern | southern`, separate from the contributor's submitted/local label
  (`raw_word_submissions.submitted_dialect`, always preserved verbatim) and from the
  admin-organized local dialect taxonomy (`dialects.name_ar`, optionally nested under a
  main group via `parent_id`). An admin reclassifies a word by changing which `dialects`
  row (and therefore which `main_group_code`) a canonical entry points to — the public
  leaderboard/explorer read this live, so the change is visible on the next request, no
  deployment needed.
- The leaderboard and explorer are served by two `SECURITY DEFINER` Postgres functions
  (`public_dialect_leaderboard()`, `public_dialect_words()`), granted to `anon` —
  consistent with the project's existing pattern of never granting direct table access
  to non-admin roles. They count only `canonical_entries` with `editorial_status =
'approved'`; raw submissions, pending/rejected/duplicate/merged-away records, and
  admin/moderation fields are never read by these functions.
- Counting rule: **one canonical word = one count**, regardless of how many raw
  submissions or examples fed into it. Merging duplicate submissions into one canonical
  entry does not increase the count; approved examples stay attached to that one entry.

## Admin prompt management (`/admin/prompts`)

Search, filter by category/active-status, inline-edit a prompt's wording/meaning/
scenario, and activate/deactivate — same admin-allowlist authorization as the rest of
`/admin/*` (`requireAdmin()`; authenticated non-admins get no access). Edits go through
`upsert_reference_prompt()` with optimistic concurrency on `prompt_version` (a stale
edit — content changed since you loaded the row — surfaces a conflict message instead of
silently overwriting). There is no delete path: prompts are retired via deactivation, so
historical submission snapshots (`raw_word_submissions.reference_prompt_snapshot`) always
stay meaningful even if a prompt's wording changes later. The submissions column shows
each prompt's raw-submission count (via `reference_prompt_submission_counts()`), so
zero-submission prompts are easy to spot.

## Export compatibility

`GET /api/admin/exports` defaults to the original, unchanged **schema v1** contract.
Pass `?schemaVersion=2` (also toggleable in the export UI) to additionally include
`main_dialect_group`, `main_dialect_group_label`, and `reference_concept_id` — v2 is
strictly additive on top of v1's fields, deterministically ordered/checksummed
independently of v1, and never exposes internal moderation/admin fields. See
`src/features/exports/projection.ts` for the versioning rationale; the v1 checksum is
locked by a regression test (`src/features/exports/export.test.ts`).

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

## Local verification with a real backend (optional)

The unit/type/lint/build checks above don't need a live Supabase project. To exercise
the guided-prompt/leaderboard/explorer flows for real locally without a hosted Supabase
project, you can run a local Postgres with the migrations applied plus
[PostgREST](https://postgrest.org) in front of it (Supabase's own hosted stack is
PostgREST + GoTrue + Postgres under the hood), then point `NEXT_PUBLIC_SUPABASE_URL` at
it. This is how the guided-contribution and leaderboard/explorer Playwright specs were
verified in this environment; `supabase start` (via the Supabase CLI) is the
officially-supported equivalent and is the better choice for day-to-day local dev.

## Notes on scope

- The export field mapping (`src/features/exports/projection.ts`) is explicitly
  versioned and marked provisional: the earlier Lahajat AI training JSON schema wasn't
  available in this workspace, so the database model is kept independent of the export
  shape (see `references/data-model.md`). Schema v2's field names are provisional too.
- `src/lib/supabase/types.ts` is hand-maintained, not generated from a live database —
  see the Supabase setup section above.
- Playwright's `admin-access` journeys cover unauthenticated redirect/login-failure
  only, since exercising the full authenticated review/merge/admin-prompt journeys
  requires a live Supabase project (or a local Postgres+PostgREST+GoTrue stack) with a
  seeded admin session — deferred rather than faked.
- The explorer's category filter is derived from the categories present in the current
  result page rather than a separate distinct-categories query; it appears only when at
  least one visible result has a category (guided-origin entries do, ordinary
  contributions don't), matching "filtering when category data exists."
- The seed migration `0015_seed_reference_prompts.sql` is machine-generated — see
  `scripts/generate-reference-prompts-seed.mjs`'s header comment before hand-editing it
  (don't; regenerate instead).
