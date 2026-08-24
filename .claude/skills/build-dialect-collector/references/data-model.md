# Data model and invariants

## Modeling approach

Separate collection, editorial review, and export. Raw tables preserve contributor input; canonical tables represent admin-approved knowledge; source links retain provenance.

Use UUIDs, UTC timestamps, database constraints, explicit foreign keys, and migrations. Generate TypeScript database types from the deployed schema.

## Core tables

### `submission_batches`

- `id`
- `idempotency_key` unique
- `consent_version`
- `submitted_at`
- `moderation_state`
- optional short-lived abuse-prevention hash and expiry; never store a raw IP address

One public request creates one batch and all child words transactionally.

### `raw_word_submissions`

- `id`
- `batch_id`
- `submitted_word`
- `submitted_dialect`
- `submitted_msa_synonym`
- `submitted_explanation` nullable
- `word_search_key`
- `dialect_search_key`
- `review_status`: `new`, `pending`, `approved`, `rejected`, `duplicate`, `merged`
- `created_at`, `updated_at`

Do not edit contributor text after insertion. Put editorial corrections in canonical records. Moderation metadata and review status may change.

### `raw_examples`

- `id`
- `raw_submission_id`
- `sentence`
- `sentence_search_key`
- `position`
- `created_at`

Require at least one example per raw word at the service/transaction layer.

### `dialects`

- `id`
- `name_ar`
- `slug`
- `parent_id` nullable
- `is_active`
- `created_at`, `updated_at`

Support hierarchical taxonomy such as a specific local label under `حجازي` without forcing the hierarchy into the export shape.

### `dialect_aliases`

- `id`
- `alias_ar`
- `alias_search_key`
- `dialect_id`
- `created_by`
- `created_at`, `updated_at`

An alias creates a recommendation, not an automatic approval.

### `canonical_entries`

- `id`
- `canonical_word`
- `canonical_word_search_key`
- `canonical_dialect_id`
- `canonical_msa_synonyms` as a typed text array or related table
- `canonical_explanation` nullable
- `editorial_status`: `draft`, `approved`, `retired`
- `version` integer for optimistic concurrency
- `approved_by`, `approved_at`
- `created_at`, `updated_at`

Do not add a unique constraint on canonical word alone. If a duplicate guard is needed, use a reviewed combination such as search key, dialect, and sense—not a destructive database rule.

### `canonical_examples`

- `id`
- `canonical_entry_id`
- `sentence`
- `sentence_search_key`
- `source_raw_example_id` nullable only for clearly marked admin-authored examples
- `position`
- `created_at`, `updated_at`

Prevent exact duplicate examples within one canonical entry using a suitable normalized compound constraint while preserving different natural sentences.

### `entry_sources`

- `canonical_entry_id`
- `raw_submission_id`
- `relation`: `primary`, `merged`, or `supporting`
- `linked_at`, `linked_by`

Use a composite primary key. Never remove source links as a side effect of editorial retirement.

### `review_events`

- `id`
- `raw_submission_id` nullable
- `canonical_entry_id` nullable
- `actor_id`
- `action`
- `before_state` JSONB
- `after_state` JSONB
- `created_at`

Record approve, reject, restore, classify, merge, unmerge/undo, and important bulk operations. Avoid secrets or unnecessary personal data in snapshots.

### `admin_submission_views`

- `admin_id`
- `raw_submission_id`
- `first_seen_at`
- `last_seen_at`

Use this to calculate per-admin unseen state independently from review status.

### `admins`

- `user_id` references the authenticated user
- `is_active`
- `created_at`

Authentication alone is insufficient; authorization requires an active row.

### `exports`

- `id`
- `created_by`
- `format`: `json` or `jsonl`
- `schema_version`
- `filters` JSONB
- `record_count`
- `checksum`
- `status`
- `created_at`, `completed_at`

Do not store large exports in PostgreSQL. Stream them to the admin or place snapshots in object storage only when that feature is explicitly added.

## Text normalization

Preserve all source/display text. Derive comparison keys with a versioned function that initially:

1. Applies Unicode NFC.
2. Trims leading/trailing whitespace.
3. Collapses internal whitespace.
4. Removes tatweel.
5. Removes Arabic combining diacritics for search only.

Do not initially collapse `ة/ه`, `ى/ي`, `ا/أ/إ/آ`, or other letter distinctions. Any future expansion must be versioned, migration-tested, and used for recommendations rather than destructive identity.

## Transaction boundaries

- Insert a batch, all words, and all examples atomically.
- Approve/classify and write its review event atomically.
- Merge canonical content, source links, statuses, examples, and review event atomically.
- Export from a consistent approved-data snapshot or transaction.

## Row-level security

- Anonymous/public roles: no direct table reads, updates, or deletes.
- Prefer a validated server endpoint for public batch insertion.
- Authenticated non-admins: no dataset access.
- Active admins: least-privilege access to review data and actions.
- Service-role credentials: server-only and never serialized, logged, or prefixed as public environment variables.

Test RLS with public, authenticated-non-admin, and active-admin identities.

## Export projection

Build a pure projection from approved canonical entries and their ordered examples. Keep the external serializer versioned and independent of table names. For unchanged records and filters:

- Sort deterministically by stable IDs or an explicitly versioned ordering.
- Serialize with stable key order.
- Produce the same bytes and checksum.
- Exclude internal moderation, admin, and abuse-prevention fields.

Do not finalize the training JSON keys until the prior agreed Lahajat AI schema is available.
