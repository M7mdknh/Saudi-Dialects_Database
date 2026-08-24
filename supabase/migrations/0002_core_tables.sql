-- Core schema: raw collection, canonical/editorial records, provenance, review, admin, export.
-- See references/data-model.md for the invariants this schema enforces.

create table if not exists submission_batches (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  consent_version text not null,
  submitted_at timestamptz not null default now(),
  moderation_state text not null default 'received',
  -- Short-lived keyed hash for abuse/rate-limit correlation only. Never a raw IP.
  abuse_hash text,
  abuse_hash_expires_at timestamptz
);

create table if not exists dialects (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  slug text not null unique,
  parent_id uuid references dialects (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dialects_parent_id_idx on dialects (parent_id);

create table if not exists dialect_aliases (
  id uuid primary key default gen_random_uuid(),
  alias_ar text not null,
  alias_search_key text not null,
  dialect_id uuid not null references dialects (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (alias_search_key)
);

create index if not exists dialect_aliases_dialect_id_idx on dialect_aliases (dialect_id);

create table if not exists raw_word_submissions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references submission_batches (id) on delete cascade,
  submitted_word text not null,
  submitted_dialect text not null,
  submitted_msa_synonym text not null,
  submitted_explanation text,
  word_search_key text not null,
  dialect_search_key text not null,
  review_status text not null default 'new'
    check (review_status in ('new', 'pending', 'approved', 'rejected', 'duplicate', 'merged')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(submitted_word) between 1 and 200),
  check (char_length(submitted_dialect) between 1 and 120),
  check (char_length(submitted_msa_synonym) between 1 and 200),
  check (submitted_explanation is null or char_length(submitted_explanation) <= 2000)
);

create index if not exists raw_word_submissions_batch_id_idx on raw_word_submissions (batch_id);
create index if not exists raw_word_submissions_review_status_idx on raw_word_submissions (review_status);
create index if not exists raw_word_submissions_word_search_key_idx on raw_word_submissions (word_search_key);
create index if not exists raw_word_submissions_dialect_search_key_idx on raw_word_submissions (dialect_search_key);
create index if not exists raw_word_submissions_created_at_idx on raw_word_submissions (created_at desc);

create table if not exists raw_examples (
  id uuid primary key default gen_random_uuid(),
  raw_submission_id uuid not null references raw_word_submissions (id) on delete cascade,
  sentence text not null,
  sentence_search_key text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  check (char_length(sentence) between 1 and 500)
);

create index if not exists raw_examples_raw_submission_id_idx on raw_examples (raw_submission_id);

create table if not exists canonical_entries (
  id uuid primary key default gen_random_uuid(),
  canonical_word text not null,
  canonical_word_search_key text not null,
  canonical_dialect_id uuid not null references dialects (id),
  canonical_msa_synonyms text[] not null default '{}',
  canonical_explanation text,
  editorial_status text not null default 'draft'
    check (editorial_status in ('draft', 'approved', 'retired')),
  version integer not null default 1,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(canonical_word) between 1 and 200)
);

-- Intentionally no unique constraint on canonical_word alone: the same
-- spelling may legitimately be a different word in a different dialect/sense.
create index if not exists canonical_entries_word_search_key_idx on canonical_entries (canonical_word_search_key);
create index if not exists canonical_entries_dialect_id_idx on canonical_entries (canonical_dialect_id);
create index if not exists canonical_entries_editorial_status_idx on canonical_entries (editorial_status);
create unique index if not exists canonical_entries_dedupe_idx
  on canonical_entries (canonical_word_search_key, canonical_dialect_id)
  where editorial_status <> 'retired';

create table if not exists canonical_examples (
  id uuid primary key default gen_random_uuid(),
  canonical_entry_id uuid not null references canonical_entries (id) on delete cascade,
  sentence text not null,
  sentence_search_key text not null,
  source_raw_example_id uuid references raw_examples (id) on delete set null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(sentence) between 1 and 500)
);

create index if not exists canonical_examples_entry_id_idx on canonical_examples (canonical_entry_id);
create unique index if not exists canonical_examples_no_dupe_idx
  on canonical_examples (canonical_entry_id, sentence_search_key);

create table if not exists entry_sources (
  canonical_entry_id uuid not null references canonical_entries (id) on delete cascade,
  raw_submission_id uuid not null references raw_word_submissions (id) on delete restrict,
  relation text not null check (relation in ('primary', 'merged', 'supporting')),
  linked_at timestamptz not null default now(),
  linked_by uuid,
  primary key (canonical_entry_id, raw_submission_id)
);

create index if not exists entry_sources_raw_submission_id_idx on entry_sources (raw_submission_id);

create table if not exists review_events (
  id uuid primary key default gen_random_uuid(),
  raw_submission_id uuid references raw_word_submissions (id) on delete set null,
  canonical_entry_id uuid references canonical_entries (id) on delete set null,
  actor_id uuid,
  action text not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

create index if not exists review_events_raw_submission_id_idx on review_events (raw_submission_id);
create index if not exists review_events_canonical_entry_id_idx on review_events (canonical_entry_id);
create index if not exists review_events_created_at_idx on review_events (created_at desc);

create table if not exists admin_submission_views (
  admin_id uuid not null,
  raw_submission_id uuid not null references raw_word_submissions (id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (admin_id, raw_submission_id)
);

create table if not exists admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists exports (
  id uuid primary key default gen_random_uuid(),
  created_by uuid,
  format text not null check (format in ('json', 'jsonl')),
  schema_version integer not null,
  filters jsonb not null default '{}',
  record_count integer not null default 0,
  checksum text,
  status text not null default 'completed' check (status in ('completed', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists exports_created_at_idx on exports (created_at desc);
