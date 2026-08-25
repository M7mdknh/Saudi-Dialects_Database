-- Guided-contribution reference prompts. Seeded deterministically from
-- data/guided-prompts.sa.ar.json via scripts/generate-reference-prompts-seed.mjs
-- (see supabase/migrations/0015_seed_reference_prompts.sql and README.md).

create table if not exists reference_prompts (
  id text primary key,
  category text not null,
  category_label_ar text not null,
  msa_lemma text not null,
  definition_ar text not null,
  scenario_ar text not null,
  part_of_speech text not null,
  answer_form text not null,
  priority integer not null check (priority in (80, 90, 100)),
  -- Doubles as the content/semantic version (bumped whenever wording or
  -- intended sense changes) and the optimistic-concurrency field for admin
  -- edits via upsert_reference_prompt().
  prompt_version integer not null default 1 check (prompt_version >= 1),
  is_active boolean not null default true,
  dataset_schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  check (char_length(msa_lemma) between 1 and 200),
  check (char_length(definition_ar) between 1 and 500),
  check (char_length(scenario_ar) between 1 and 500)
);

create index if not exists reference_prompts_category_idx on reference_prompts (category);
create index if not exists reference_prompts_is_active_idx on reference_prompts (is_active);
create index if not exists reference_prompts_priority_idx on reference_prompts (priority);

drop trigger if exists trg_reference_prompts_updated_at on reference_prompts;
create trigger trg_reference_prompts_updated_at
  before update on reference_prompts
  for each row execute function set_updated_at();

alter table reference_prompts enable row level security;

-- Prompt content is public-safe reference data, but reads still go through
-- list_active_reference_prompts() (see 0013) rather than a direct table
-- grant, keeping every public-facing read path in this project uniform
-- (function-mediated, never a blanket table SELECT to anon/authenticated).
-- Admins read the full table (active and inactive) directly for management.
create policy admin_read_reference_prompts on reference_prompts
  for select to authenticated using (is_active_admin(auth.uid()));
