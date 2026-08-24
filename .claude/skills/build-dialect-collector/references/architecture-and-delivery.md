# Architecture and delivery

## Application boundaries

Use one Next.js application with clear modules rather than premature services.

Suggested routes:

- `/` — public Arabic contribution page
- `/admin/login` — private sign-in
- `/admin` — dashboard and review grid
- `/admin/review/[id]` — detailed review/merge workspace when a drawer is insufficient
- `/api/submissions` — validated public batch submission
- `/api/admin/exports` — authorized streaming export

Route names may change when implementation warrants it; preserve the security boundaries.

Suggested source areas:

- `src/features/contributions` — public form, schemas, and submission service
- `src/features/review` — grid, details, actions, duplicate review, and merge
- `src/features/dialects` — taxonomy and aliases
- `src/features/exports` — versioned projection and serializers
- `src/lib/supabase` — browser/server/admin clients with explicit separation
- `supabase/migrations` — schema, functions, constraints, indexes, and RLS

Avoid a generic `utils` dumping ground. Keep business rules in named domain modules.

## State and validation

- Use one shared Zod contract for the batch shape and shared constants for limits.
- Validate again on the server; client validation is only feedback.
- Generate an idempotency key when a draft begins and rotate it after confirmed success.
- Keep public draft state local to the browser. Do not create partial database submissions in V1.
- Represent server/domain errors with stable codes and map them to friendly Arabic messages at the UI boundary.

## Admin editing

- Use server-side pagination, filtering, and sorting.
- Use optimistic concurrency with a record version or conditional `updated_at`.
- Return a specific stale-write result and let the admin compare/reload instead of silently overwriting.
- Keep bulk actions bounded and transactional where records must change together.

## Security checklist

- Apply RLS to every public-schema table and test policies.
- Keep admin authorization in server code and database policy/function boundaries.
- Verify Turnstile server-side and rate-limit by a privacy-preserving key.
- Use secure, HTTP-only session cookies through the supported Supabase SSR pattern.
- Add safe security headers and a content security policy compatible with Vercel, Supabase, and Turnstile.
- Redact secrets and contributor text from structured production logs unless the text is essential to a diagnosed error.
- Bound batch count, field length, example count, and total request bytes.

## Environment variables

Expected names after scaffolding:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY
ABUSE_HASH_SECRET
```

Never commit real values. Add a documented `.env.example` with placeholders when the application is scaffolded. `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, and `ABUSE_HASH_SECRET` are server-only.

## Test strategy

### Unit tests

- Arabic search-key normalization
- Shared submission validation
- Duplicate scoring inputs
- Export filtering, ordering, JSON, JSONL, and checksum determinism

### Database/integration tests

- RLS roles and admin allowlist
- Atomic batch insertion
- Status transitions
- Merge and undo transaction behavior
- Source and review-event retention

### Browser tests

- Mobile public multi-word submission
- Draft recovery and clearing after success
- Arabic validation and focus behavior
- Admin sign-in and access denial
- New marker, inline edit, approve, merge, and export journeys

Avoid testing component-library internals. Test domain behavior and critical journeys.

## Deployment sequence

1. Create Supabase development and production projects when credentials are available.
2. Apply migrations and generate database types.
3. Create the initial admin Auth user and active `admins` row through a controlled setup path.
4. Configure Vercel environment variables separately for preview and production.
5. Configure Turnstile hostnames for local/preview/production as supported.
6. Run lint, type checking, unit/integration tests, browser smoke tests, and production build.
7. Deploy to a Vercel preview and verify public submission, admin authorization, and export.
8. Apply production migrations through a deliberate release step, then deploy production.

Do not make Google Drive a deployment dependency in V1. Treat manual JSON/JSONL download as the backup/export path until automatic snapshotting is explicitly scheduled.

## Free-tier awareness

Text records should fit comfortably within the initial Supabase free database for the expected V1 scale, but instrument record counts and database size. Avoid storing generated exports, screenshots, or other binary assets in PostgreSQL. Surface clear operational guidance before any quota becomes a production failure.

## Completion report

For each implemented slice, report:

- User-visible outcome
- Files and migrations changed
- Tests and browser journeys run
- New environment variables or manual setup
- Deployment or data-migration risk
- Deferred scope
