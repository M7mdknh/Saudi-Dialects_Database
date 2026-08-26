-- Additive fields needed by the v4 clean-dictionary export (and, later, the
-- full canonical dictionary editor): a free-form admin-settable concept
-- link distinct from the guided-prompt `reference_prompt_id`, a register
-- tag, and a related-words list. None of this touches existing data —
-- every column is nullable or defaults to an empty array, so every
-- previously-approved canonical entry keeps exporting exactly as before
-- under schema v1/v2/v3.

alter table canonical_entries
  add column if not exists concept_id text,
  add column if not exists register text,
  add column if not exists related_words text[] not null default '{}';

alter table canonical_entries
  drop constraint if exists canonical_entries_register_check;

alter table canonical_entries
  add constraint canonical_entries_register_check
    check (register is null or register in (
      'neutral', 'informal', 'slang', 'offensive', 'taboo', 'archaic'
    ));

comment on column canonical_entries.concept_id is
  'Free-form admin-set identifier linking words that represent the same concept. Distinct from reference_prompt_id (guided-prompt provenance). Never invented by the exporter — null unless an admin has set it.';
comment on column canonical_entries.register is
  'Optional register tag for the v4 dictionary export: neutral, informal, slang, offensive, taboo, or archaic.';
comment on column canonical_entries.related_words is
  'Admin-curated list of related canonical words (free text, not a foreign key), shown/exported alongside the entry. Never spelling variants of the entry itself.';

-- The ALLaM training JSONL export logs itself through the same record_export()
-- path as every other export format; widen the existing check constraint to
-- accept it alongside the original 'json'/'jsonl' values (additive, no
-- existing row is affected since none can have had this value before).
alter table exports
  drop constraint if exists exports_format_check;

alter table exports
  add constraint exports_format_check
    check (format in ('json', 'jsonl', 'allam-jsonl'));
