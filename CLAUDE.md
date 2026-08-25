# Lahajat AI Dialect Collector

## Mission

Build a small Arabic-first web application that crowdsources dialect words and turns them into a reviewed, provenance-preserving dataset for Lahajat AI.

The public experience must stay extremely simple. The admin experience must make reviewing, editing, classifying, merging, and exporting records feel as efficient as working in a spreadsheet.

## Current phase

V1 is scaffolded and implemented. V2 has since been approved and implemented on top of it: the project's scope narrowed to **Saudi dialects only**, and the public experience now includes a guided-contribution path (a reference-prompt bank of 300 concepts, `data/guided-prompts.sa.ar.json`), a five-group Saudi classification (`main_group_code`: حجازي، نجدي، شرقاوي، شمالي، جنوبي), a public leaderboard, a public per-dialect explorer, and admin prompt management. See `README.md` for the concrete routes, migrations, and dataset workflow. Do not add public dictionary browsing beyond the approved explorer, voting, contributor accounts, audio, AI classification, multi-admin roles, email notifications, or automatic Google Drive sync unless explicitly requested.

## Approved stack

- Next.js App Router with TypeScript in strict mode
- Tailwind CSS and accessible reusable UI components
- Supabase PostgreSQL, Auth, migrations, and row-level security
- Zod validation shared by client and server
- Vercel deployment
- Vitest for unit/integration tests and Playwright for critical user journeys
- Cloudflare Turnstile or an equivalent low-friction anti-spam check

Do not pin package versions in documentation. Let the package manager record installed versions.

## Product surfaces

### Public page

Provide one mobile-first Arabic RTL page where an anonymous contributor can:

1. Enter a dialect word and its dialect or region.
2. Enter its Modern Standard Arabic synonym.
3. Optionally explain its meaning and when it is used.
4. Add at least one example sentence and any number of additional examples.
5. Add more word cards to the same submission batch.
6. Consent to dataset use and submit successfully without creating an account.

Autosave unfinished form data locally. Use a practical client-side maximum of 50 word cards per batch to protect the browser and endpoint; describe the experience to users as allowing multiple words, not as an artificial collection limit.

### Admin area

Provide a private admin login and an Arabic RTL workspace with:

- Visible counts for new, pending, approved, rejected, duplicate, and merged records
- A reliable new-submission marker
- Spreadsheet-like inline editing, search, sorting, filters, multi-select, and bulk actions
- Separate submitted and canonical dialect values
- Possible-duplicate suggestions, never automatic merging
- A side-by-side merge workspace that can reuse unique examples from every source
- Approval, rejection, duplicate, merge, and undo-capable review actions
- JSON and JSONL export of approved canonical records only
- Export filters, preview count, schema version, record count, timestamp, and checksum

## Non-negotiable data rules

1. Treat PostgreSQL as the source of truth. Never use a mutable JSON file as the live database.
2. Keep raw submissions immutable except for moderation metadata. Preserve exactly what the contributor entered.
3. Store editorial decisions in canonical records. Never overwrite `submitted_dialect` with `canonical_dialect`.
4. Do not export pending, rejected, duplicate, or unreviewed records.
5. Every canonical sentence copied from a submission must retain its source reference.
6. A merge must preserve all source submissions and review history.
7. Duplicate detection may recommend; only an admin may merge or reject.
8. Normalize text only into separate search keys. Never replace the displayed/source Arabic with normalized text.
9. Do not collapse Arabic letters such as `ة/ه`, `ى/ي`, or hamza forms during initial duplicate detection.
10. Make consequential review actions auditable and reversible where practical.

The exact training-export field names from the earlier Lahajat AI data discussion are not available in this workspace. Keep the exporter behind a mapping layer and do not declare the external training JSON contract final until that earlier schema is supplied or reconfirmed. The internal database model must not depend on one export shape.

## Arabic UX rules

- Set document direction to `rtl` and language to `ar`.
- All contributor-facing and admin-facing copy must be Arabic.
- Use natural Arabic labels and concise helper text; do not expose internal English status values.
- Use an Arabic-capable font with a robust system fallback and avoid runtime dependence on an external font CDN.
- Make tap targets comfortable and ensure form completion works well on mobile.
- Keep the public page visually warm and encouraging, but prioritize clarity and speed.
- Do not rely on color alone for statuses, errors, or selection.
- Meet WCAG 2.2 AA for contrast, focus visibility, labeling, keyboard use, and error identification.

## Security and privacy

- Accept public submissions only through validated server-side code.
- Do not expose the Supabase service-role key to the browser.
- Enable row-level security on every exposed table.
- Public users may submit but may never list, read, edit, or delete submissions.
- Restrict admin access to an explicit allowlist even after successful authentication.
- Rate-limit submissions, validate Turnstile server-side, cap payload sizes, and return generic errors.
- Collect no contributor email, account, or name in V1.
- Do not persist raw IP addresses. If abuse protection needs an identifier, use a short-lived keyed hash and document its retention.
- Escape untrusted text and protect state-changing admin operations against cross-site request forgery where applicable.

## Engineering workflow

1. Read `.claude/skills/build-dialect-collector/SKILL.md` for any implementation, review, database, UI, export, or deployment work in this project.
2. Read only the skill references relevant to the current task.
3. Inspect existing code, migrations, tests, and working-tree changes before editing.
4. State assumptions when requirements remain undecided; do not silently invent irreversible data behavior.
5. Implement the smallest complete vertical slice and include its loading, empty, success, validation, and failure states.
6. Add or update tests for data invariants and user-visible behavior.
7. Run formatting, linting, type checking, tests, and a production build before declaring a change complete.
8. For UI changes, run the app and verify the affected journey at mobile and desktop widths.
9. Update this file or the skill references only when a durable project decision changes.

## Expected commands after scaffolding

Prefer package scripts and keep these names available:

```bash
npm run dev
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

If the project is scaffolded with a different package manager, use it consistently and update this section.

## Definition of done

A change is complete only when:

- The requested behavior works in Arabic RTL on mobile and desktop.
- Validation and authorization exist on the server, not only in the browser.
- Raw-source provenance and review invariants remain intact.
- Relevant automated tests pass.
- Lint, type checking, and production build pass.
- New environment variables, migrations, and deployment steps are documented.
- No secret, real contributor data, or generated export is committed.
