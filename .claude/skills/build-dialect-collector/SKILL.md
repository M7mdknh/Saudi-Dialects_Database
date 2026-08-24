---
name: build-dialect-collector
description: Implement, modify, review, test, or deploy the Lahajat AI Arabic dialect crowdsourcing website. Use for the public multi-word form, Arabic RTL UI, Supabase schema and RLS, admin spreadsheet review, dialect normalization, duplicate and merge workflows, provenance, approved JSON or JSONL exports, and Vercel readiness.
---

# Build the dialect collector

Follow `CLAUDE.md` and protect its data invariants before optimizing convenience.

## Load the relevant references

- Read `references/product-spec.md` for feature scope, journeys, states, and acceptance criteria.
- Read `references/data-model.md` before changing migrations, queries, review logic, duplicate detection, merges, or exports.
- Read `references/ux-guidelines.md` before building or reviewing contributor/admin UI.
- Read `references/architecture-and-delivery.md` before scaffolding, changing application boundaries, authentication, security, tests, environment configuration, or deployment.

Do not load unrelated references merely because they exist.

## Work sequence

1. Inspect the repository, active migrations, generated database types, tests, and uncommitted changes.
2. Identify the smallest end-to-end slice that satisfies the request.
3. Write down any assumption that changes data ownership, review status, merging, or export eligibility.
4. Design server-side validation and authorization before wiring the client.
5. Preserve raw contributor text and write normalization only to derived search keys.
6. Implement all relevant UI states: initial, loading, empty, validation error, server error, success, and retry.
7. Add tests at the lowest useful layer, including database/integration coverage for critical invariants.
8. Run lint, type checking, tests, production build, and the affected browser journey.
9. Report migrations, environment variables, deployment implications, and anything intentionally deferred.

## Implementation guardrails

- Prefer server components for reads and small client islands for interactive forms and the admin grid.
- Keep domain operations such as approve, reject, merge, restore, and export in explicit server-side services or commands.
- Make merge operations transactional.
- Use stable IDs; never identify records by editable Arabic text.
- Prevent stale admin edits with an `updated_at` or version precondition and show a conflict message instead of overwriting newer work.
- Keep export transformation pure and testable. Sort deterministically before serialization.
- Avoid destructive cascading deletes for raw submissions, raw examples, source links, and review events.
- Keep public endpoints idempotent where retries could otherwise duplicate a batch. Use a client-generated idempotency key.
- Paginate or virtualize the admin grid; never fetch the entire dataset into the browser.
- Do not add AI classification or silently accept duplicate recommendations.

## Verification focus

Always test the invariant most at risk. Examples:

- A public visitor can insert but cannot read submissions.
- One invalid word card rejects the batch atomically and identifies the card.
- Opening a row changes its seen state without approving it.
- Canonical dialect changes do not alter the submitted dialect.
- Merging retains every source and unique example.
- Undo restores the prior editorial state.
- Exports contain only approved canonical records and are byte-for-byte deterministic for unchanged data.
- Arabic keyboard input, RTL layout, focus order, and validation remain usable on a narrow mobile viewport.
