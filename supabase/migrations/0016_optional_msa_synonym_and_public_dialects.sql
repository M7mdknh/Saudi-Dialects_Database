-- Two independent changes bundled because both were needed for the same
-- production fix pass:
--
-- 1. The formal-Arabic (MSA) synonym becomes optional for ordinary
--    contributions. Guided contributions still always carry one (it comes
--    from the reference prompt), but an ordinary "add your own word"
--    submission must not be blocked on it. Blank is stored as NULL, never
--    as an empty string (CLAUDE.md: never store meaningless whitespace).
--
-- 2. A public-safe read function for the dialect taxonomy, so the
--    contribution form's dialect combobox can show the five main Saudi
--    groups plus existing local dialects. Consistent with the project's
--    existing convention (0013): no direct table grant to anon/authenticated,
--    every public read goes through a SECURITY DEFINER function that
--    returns only explicitly safe columns.

-- --- 1. Optional MSA synonym -------------------------------------------

alter table raw_word_submissions
  drop constraint if exists raw_word_submissions_submitted_msa_synonym_check;

alter table raw_word_submissions
  alter column submitted_msa_synonym drop not null;

alter table raw_word_submissions
  add constraint raw_word_submissions_submitted_msa_synonym_check
    check (submitted_msa_synonym is null or char_length(submitted_msa_synonym) between 1 and 200);

-- submit_batch (0011): same signature. Blank/whitespace-only synonym is
-- stored as NULL instead of a zero-length string, matching the existing
-- treatment of `explanation`.
create or replace function submit_batch(
  p_idempotency_key uuid,
  p_consent_version text,
  p_words jsonb,
  p_abuse_hash text,
  p_abuse_hash_expires_at timestamptz
)
returns table (batch_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_word jsonb;
  v_example jsonb;
  v_submission_id uuid;
  v_word_position integer := 0;
begin
  select id into v_batch_id from submission_batches where idempotency_key = p_idempotency_key;
  if v_batch_id is not null then
    return query select v_batch_id, false;
    return;
  end if;

  if jsonb_array_length(p_words) < 1 or jsonb_array_length(p_words) > 50 then
    raise exception 'invalid_word_count' using errcode = '22023';
  end if;

  insert into submission_batches (idempotency_key, consent_version, abuse_hash, abuse_hash_expires_at)
  values (p_idempotency_key, p_consent_version, p_abuse_hash, p_abuse_hash_expires_at)
  returning id into v_batch_id;

  for v_word in select * from jsonb_array_elements(p_words)
  loop
    if jsonb_array_length(v_word -> 'examples') < 1 then
      raise exception 'missing_example' using errcode = '22023';
    end if;

    insert into raw_word_submissions (
      batch_id, submitted_word, submitted_dialect, submitted_msa_synonym,
      submitted_explanation, word_search_key, dialect_search_key, position,
      reference_prompt_id, reference_prompt_snapshot
    ) values (
      v_batch_id,
      v_word ->> 'word',
      v_word ->> 'dialect',
      nullif(v_word ->> 'msaSynonym', ''),
      nullif(v_word ->> 'explanation', ''),
      v_word ->> 'wordSearchKey',
      v_word ->> 'dialectSearchKey',
      v_word_position,
      nullif(v_word ->> 'referencePromptId', ''),
      v_word -> 'referencePromptSnapshot'
    )
    returning id into v_submission_id;

    for v_example in select * from jsonb_array_elements(v_word -> 'examples')
    loop
      insert into raw_examples (raw_submission_id, sentence, sentence_search_key, position)
      values (
        v_submission_id,
        v_example ->> 'sentence',
        v_example ->> 'sentenceSearchKey',
        coalesce((v_example ->> 'position')::integer, 0)
      );
    end loop;

    v_word_position := v_word_position + 1;
  end loop;

  return query select v_batch_id, true;
end;
$$;

-- classify_submission (0011): same signature. A NULL submitted synonym must
-- become an empty canonical_msa_synonyms array, not array[NULL] (which is a
-- one-element array containing a null, not "no synonyms").
create or replace function classify_submission(p_actor uuid, p_submission_id uuid, p_dialect_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_raw raw_word_submissions%rowtype;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_raw from raw_word_submissions where id = p_submission_id;
  if v_raw.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select canonical_entry_id into v_entry_id
  from entry_sources
  where raw_submission_id = p_submission_id and relation = 'primary'
  limit 1;

  if v_entry_id is null then
    insert into canonical_entries (
      canonical_word, canonical_word_search_key, canonical_dialect_id,
      canonical_msa_synonyms, canonical_explanation, editorial_status,
      reference_prompt_id
    ) values (
      v_raw.submitted_word, v_raw.word_search_key, p_dialect_id,
      case when v_raw.submitted_msa_synonym is null then '{}'::text[] else array[v_raw.submitted_msa_synonym] end,
      v_raw.submitted_explanation, 'draft',
      v_raw.reference_prompt_id
    )
    returning id into v_entry_id;

    insert into entry_sources (canonical_entry_id, raw_submission_id, relation, linked_by)
    values (v_entry_id, p_submission_id, 'primary', p_actor);
  else
    update canonical_entries
    set canonical_dialect_id = p_dialect_id, version = version + 1
    where id = v_entry_id;
  end if;

  if v_raw.review_status = 'new' then
    update raw_word_submissions set review_status = 'pending' where id = p_submission_id;
  end if;

  insert into review_events (raw_submission_id, canonical_entry_id, actor_id, action, after_state)
  values (p_submission_id, v_entry_id, p_actor, 'classify', jsonb_build_object('canonical_dialect_id', p_dialect_id));

  return v_entry_id;
end;
$$;

-- --- 2. Public-safe dialect taxonomy read -------------------------------

-- Active main groups and local dialects only, for the public contribution
-- form's searchable/creatable combobox. Never exposes inactive/legacy rows
-- (the deactivated pan-Arab 0005 seed) or admin-only fields.
create or replace function list_public_dialects()
returns table (
  id uuid,
  name_ar text,
  slug text,
  parent_id uuid,
  main_group_code text
)
language sql
stable
security definer
set search_path = public
as $$
  select id, name_ar, slug, parent_id, main_group_code
  from dialects
  where is_active = true
  order by
    (parent_id is null and main_group_code is not null) desc,
    main_group_code nulls last,
    name_ar asc;
$$;

grant execute on function list_public_dialects() to anon, authenticated;
