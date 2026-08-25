-- Nullable guided-contribution linkage. Ordinary submissions never touch
-- these columns; guided submissions record the prompt they answered plus a
-- point-in-time snapshot so an edited prompt never rewrites history for
-- already-submitted answers (CLAUDE.md rule: raw contributor text/context
-- stays immutable).

alter table raw_word_submissions
  add column if not exists reference_prompt_id text references reference_prompts (id) on delete set null,
  add column if not exists reference_prompt_snapshot jsonb;

create index if not exists raw_word_submissions_reference_prompt_id_idx
  on raw_word_submissions (reference_prompt_id);

-- Only where semantically correct (a guided/prompt-originated concept), and
-- only ever set automatically from the linked raw submission — never forced
-- on ordinary entries. Nullable; admins may also clear or leave it unset.
alter table canonical_entries
  add column if not exists reference_prompt_id text references reference_prompts (id) on delete set null;

create index if not exists canonical_entries_reference_prompt_id_idx
  on canonical_entries (reference_prompt_id);

-- Correctness fix (same signature, discovered while testing this migration
-- against a real Postgres instance): review_raw_submission's SELECT used a
-- bare `updated_at`, which plpgsql treats as ambiguous against the
-- RETURNS TABLE(..., updated_at, ...) column of the same name — every call
-- (i.e. every admin approve/reject/duplicate/pending action) raised
-- "column reference is ambiguous". Qualifying the reference fixes it.
create or replace function review_raw_submission(
  p_actor uuid,
  p_submission_id uuid,
  p_new_status text,
  p_expected_updated_at timestamptz
)
returns table (id uuid, review_status text, updated_at timestamptz, stale boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_current timestamptz;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_new_status not in ('pending', 'approved', 'rejected', 'duplicate') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select raw_word_submissions.updated_at, to_jsonb(raw_word_submissions.*) into v_current, v_before
  from raw_word_submissions where raw_word_submissions.id = p_submission_id
  for update;

  if v_current is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_expected_updated_at is not null and v_current <> p_expected_updated_at then
    return query select p_submission_id, (v_before ->> 'review_status')::text, v_current, true;
    return;
  end if;

  update raw_word_submissions
  set review_status = p_new_status
  where raw_word_submissions.id = p_submission_id
  returning raw_word_submissions.updated_at into v_current;

  insert into review_events (raw_submission_id, actor_id, action, before_state, after_state)
  values (
    p_submission_id, p_actor, 'status_change', v_before,
    jsonb_set(v_before, '{review_status}', to_jsonb(p_new_status))
  );

  return query select p_submission_id, p_new_status, v_current, false;
end;
$$;

-- submit_batch() now also persists per-word prompt linkage when the client
-- includes referencePromptId/referencePromptSnapshot on a word. Same
-- signature as before (still one jsonb p_words parameter), so no existing
-- call site needs to change.
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
      v_word ->> 'msaSynonym',
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

-- classify_submission (0008) now also carries the raw submission's prompt
-- link onto the draft canonical entry it creates, same signature.
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
      array[v_raw.submitted_msa_synonym], v_raw.submitted_explanation, 'draft',
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

-- upsert_canonical_entry (0003) gains a trailing, defaulted
-- p_reference_prompt_id so approve-and-edit can carry the link too, without
-- breaking any existing call (old call sites simply omit it -> null ->
-- "leave whatever is already on the entry unchanged").
drop function if exists upsert_canonical_entry(uuid, uuid, integer, text, text, uuid, text[], text, text);

create or replace function upsert_canonical_entry(
  p_actor uuid,
  p_entry_id uuid,
  p_expected_version integer,
  p_canonical_word text,
  p_canonical_word_search_key text,
  p_canonical_dialect_id uuid,
  p_canonical_msa_synonyms text[],
  p_canonical_explanation text,
  p_editorial_status text,
  p_reference_prompt_id text default null
)
returns table (id uuid, version integer, stale boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_current_version integer;
  v_id uuid;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_entry_id is null then
    insert into canonical_entries (
      canonical_word, canonical_word_search_key, canonical_dialect_id,
      canonical_msa_synonyms, canonical_explanation, editorial_status,
      approved_by, approved_at, reference_prompt_id
    ) values (
      p_canonical_word, p_canonical_word_search_key, p_canonical_dialect_id,
      p_canonical_msa_synonyms, nullif(p_canonical_explanation, ''), p_editorial_status,
      case when p_editorial_status = 'approved' then p_actor end,
      case when p_editorial_status = 'approved' then now() end,
      p_reference_prompt_id
    )
    returning canonical_entries.id, canonical_entries.version into v_id, v_current_version;

    insert into review_events (canonical_entry_id, actor_id, action, before_state, after_state)
    values (v_id, p_actor, 'create', null, to_jsonb(row(v_id)));

    return query select v_id, v_current_version, false;
    return;
  end if;

  -- Qualified explicitly: RETURNS TABLE(..., version, ...) makes plpgsql
  -- treat a bare `version` as ambiguous against the table column (verified
  -- against a real Postgres instance — this was a latent bug in the
  -- pre-existing function's UPDATE branch, never exercised because the app
  -- always calls with entry_id = null today; fixed here while replacing
  -- the function for the reference_prompt_id parameter).
  select canonical_entries.version, to_jsonb(canonical_entries.*) into v_current_version, v_before
  from canonical_entries where canonical_entries.id = p_entry_id
  for update;

  if v_current_version is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_expected_version is not null and v_current_version <> p_expected_version then
    return query select p_entry_id, v_current_version, true;
    return;
  end if;

  update canonical_entries set
    canonical_word = p_canonical_word,
    canonical_word_search_key = p_canonical_word_search_key,
    canonical_dialect_id = p_canonical_dialect_id,
    canonical_msa_synonyms = p_canonical_msa_synonyms,
    canonical_explanation = nullif(p_canonical_explanation, ''),
    editorial_status = p_editorial_status,
    version = canonical_entries.version + 1,
    approved_by = case when p_editorial_status = 'approved' then p_actor else approved_by end,
    approved_at = case when p_editorial_status = 'approved' then now() else approved_at end,
    reference_prompt_id = coalesce(canonical_entries.reference_prompt_id, p_reference_prompt_id)
  where canonical_entries.id = p_entry_id
  returning canonical_entries.version into v_current_version;

  insert into review_events (canonical_entry_id, actor_id, action, before_state, after_state)
  values (p_entry_id, p_actor, 'edit', v_before, to_jsonb((select ce from canonical_entries ce where ce.id = p_entry_id)));

  return query select p_entry_id, v_current_version, false;
end;
$$;

grant execute on function upsert_canonical_entry(uuid, uuid, integer, text, text, uuid, text[], text, text, text) to authenticated;

-- merge_submissions (0003) gains the same trailing, defaulted parameter.
drop function if exists merge_submissions(uuid, uuid[], uuid, text, text, uuid, text[], text, jsonb);

create or replace function merge_submissions(
  p_actor uuid,
  p_raw_submission_ids uuid[],
  p_target_entry_id uuid,
  p_canonical_word text,
  p_canonical_word_search_key text,
  p_canonical_dialect_id uuid,
  p_canonical_msa_synonyms text[],
  p_canonical_explanation text,
  p_examples jsonb,
  p_reference_prompt_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_before jsonb;
  v_raw_id uuid;
  v_example jsonb;
  v_is_first boolean := true;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if array_length(p_raw_submission_ids, 1) is null or array_length(p_raw_submission_ids, 1) < 1 then
    raise exception 'no_sources' using errcode = '22023';
  end if;

  if p_target_entry_id is null then
    insert into canonical_entries (
      canonical_word, canonical_word_search_key, canonical_dialect_id,
      canonical_msa_synonyms, canonical_explanation, editorial_status,
      approved_by, approved_at, reference_prompt_id
    ) values (
      p_canonical_word, p_canonical_word_search_key, p_canonical_dialect_id,
      p_canonical_msa_synonyms, nullif(p_canonical_explanation, ''), 'approved', p_actor, now(),
      p_reference_prompt_id
    )
    returning id into v_entry_id;
  else
    v_entry_id := p_target_entry_id;
    select to_jsonb(canonical_entries.*) into v_before from canonical_entries where id = v_entry_id for update;
    update canonical_entries set
      canonical_word = p_canonical_word,
      canonical_word_search_key = p_canonical_word_search_key,
      canonical_dialect_id = p_canonical_dialect_id,
      canonical_msa_synonyms = p_canonical_msa_synonyms,
      canonical_explanation = nullif(p_canonical_explanation, ''),
      editorial_status = 'approved',
      version = version + 1,
      approved_by = p_actor,
      approved_at = now(),
      reference_prompt_id = coalesce(canonical_entries.reference_prompt_id, p_reference_prompt_id)
    where id = v_entry_id;
  end if;

  foreach v_raw_id in array p_raw_submission_ids loop
    insert into entry_sources (canonical_entry_id, raw_submission_id, relation, linked_by)
    values (v_entry_id, v_raw_id, case when v_is_first then 'primary' else 'merged' end, p_actor)
    on conflict (canonical_entry_id, raw_submission_id) do nothing;

    update raw_word_submissions set review_status = 'merged' where id = v_raw_id;
    v_is_first := false;
  end loop;

  for v_example in select * from jsonb_array_elements(coalesce(p_examples, '[]'::jsonb))
  loop
    insert into canonical_examples (
      canonical_entry_id, sentence, sentence_search_key, source_raw_example_id, position
    ) values (
      v_entry_id,
      v_example ->> 'sentence',
      v_example ->> 'sentenceSearchKey',
      nullif(v_example ->> 'sourceRawExampleId', '')::uuid,
      coalesce((v_example ->> 'position')::integer, 0)
    )
    on conflict (canonical_entry_id, sentence_search_key) do nothing;
  end loop;

  insert into review_events (canonical_entry_id, actor_id, action, before_state, after_state)
  values (
    v_entry_id, p_actor, 'merge', v_before,
    jsonb_build_object('canonical_entry_id', v_entry_id, 'source_ids', p_raw_submission_ids)
  );

  return v_entry_id;
end;
$$;

grant execute on function merge_submissions(uuid, uuid[], uuid, text, text, uuid, text[], text, jsonb, text) to authenticated;
