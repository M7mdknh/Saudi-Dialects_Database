-- Fixes a confirmed production failure: bulkApproveWithSubmittedDialects()
-- called approve_raw_submission() once per row through 25 separate
-- sequential PostgREST round-trips inside one server action. Each RPC call
-- is its own transaction, so a row that already succeeded (e.g. row 1,
-- 'مديني') was genuinely committed as approved — but the very next row
-- throwing (e.g. a since-deactivated trusted dialect id, raising
-- 'invalid_dialect' per migration 0023) propagated out of the JS `for`
-- loop, aborting bulkApproveWithSubmittedDialects() before it could ever
-- return its accumulated per-row results. The client's catch block then
-- showed a single generic "تعذّر تنفيذ الاعتماد" for the whole batch, with
-- no way to learn that most rows had actually succeeded, and never called
-- router.refresh() — reproduced and confirmed live: see the session that
-- introduced this migration.
--
-- bulk_approve_submissions()/bulk_classify_submissions() replace that
-- per-row network loop with one PostgREST round-trip per batch. Each row is
-- processed inside its own `begin ... exception when others` block, which
-- PL/pgSQL implements with an implicit subtransaction (savepoint): a
-- failing row rolls back only its own work and is reported as a structured
-- result, while every other row's work commits normally as part of the
-- single enclosing transaction. This also removes the N-sequential-round-
-- trip latency that risked a platform execution timeout on a 25-row batch.
--
-- approve_raw_submission() also gains one more safety property here: two
-- different raw submissions that resolve to the exact same
-- (canonical_word_search_key, canonical_dialect_id) — e.g. two
-- contributors independently submitting the same word in the same dialect
-- — used to hit canonical_entries_dedupe_idx as a hard unique-violation on
-- the second row. It now reuses the existing canonical entry as a
-- 'supporting' source instead of failing that row, matching the merge
-- model's existing 'primary' | 'merged' | 'supporting' vocabulary
-- (data-model.md) and never erroring the batch over a legitimate
-- same-word coincidence.

create or replace function approve_raw_submission(
  p_actor uuid,
  p_submission_id uuid,
  p_dialect_id uuid,
  p_expected_updated_at timestamptz,
  p_use_raw_defaults boolean default true,
  p_canonical_word text default null,
  p_canonical_word_search_key text default null,
  p_canonical_msa_synonyms text[] default null,
  p_canonical_explanation text default null,
  p_visibility text default 'public'
)
returns table (
  entry_id uuid,
  review_status text,
  updated_at timestamptz,
  stale boolean,
  public_visibility text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw raw_word_submissions%rowtype;
  v_before jsonb;
  v_current timestamptz;
  v_entry_id uuid;
  v_word text;
  v_word_key text;
  v_synonyms text[];
  v_explanation text;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_dialect_id is null then
    raise exception 'dialect_required' using errcode = '22023';
  end if;

  if not exists (select 1 from dialects where id = p_dialect_id and is_active = true) then
    raise exception 'invalid_dialect' using errcode = '22023';
  end if;

  if p_visibility not in ('public', 'private') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;

  select * into v_raw from raw_word_submissions where raw_word_submissions.id = p_submission_id for update;
  if v_raw.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_expected_updated_at is not null and v_raw.updated_at <> p_expected_updated_at then
    return query select null::uuid, v_raw.review_status, v_raw.updated_at, true, null::text;
    return;
  end if;

  v_before := to_jsonb(v_raw);

  if p_use_raw_defaults then
    v_word := v_raw.submitted_word;
    v_word_key := v_raw.word_search_key;
    v_synonyms := case when v_raw.submitted_msa_synonym is null then '{}'::text[] else array[v_raw.submitted_msa_synonym] end;
    v_explanation := v_raw.submitted_explanation;
  else
    v_word := coalesce(p_canonical_word, v_raw.submitted_word);
    v_word_key := coalesce(p_canonical_word_search_key, v_raw.word_search_key);
    v_synonyms := coalesce(p_canonical_msa_synonyms, '{}'::text[]);
    v_explanation := nullif(p_canonical_explanation, '');
  end if;

  select entry_sources.canonical_entry_id into v_entry_id
  from entry_sources
  where entry_sources.raw_submission_id = p_submission_id and entry_sources.relation = 'primary'
  limit 1;

  if v_entry_id is null then
    insert into canonical_entries (
      canonical_word, canonical_word_search_key, canonical_dialect_id,
      canonical_msa_synonyms, canonical_explanation, editorial_status,
      approved_by, approved_at, reference_prompt_id, public_visibility
    ) values (
      v_word, v_word_key, p_dialect_id, v_synonyms, v_explanation, 'approved',
      p_actor, now(), v_raw.reference_prompt_id, p_visibility
    )
    on conflict (canonical_word_search_key, canonical_dialect_id) where editorial_status <> 'retired'
    do nothing
    returning id into v_entry_id;

    if v_entry_id is null then
      -- Another submission already created a canonical entry for this exact
      -- word + dialect. Reuse it rather than failing this row.
      select id into v_entry_id
      from canonical_entries
      where canonical_word_search_key = v_word_key
        and canonical_dialect_id = p_dialect_id
        and editorial_status <> 'retired'
      limit 1;

      insert into entry_sources (canonical_entry_id, raw_submission_id, relation, linked_by)
      values (v_entry_id, p_submission_id, 'supporting', p_actor)
      on conflict (canonical_entry_id, raw_submission_id) do nothing;

      update canonical_entries set
        editorial_status = 'approved',
        public_visibility = p_visibility,
        approved_by = coalesce(approved_by, p_actor),
        approved_at = coalesce(approved_at, now())
      where id = v_entry_id and editorial_status <> 'approved';
    else
      insert into entry_sources (canonical_entry_id, raw_submission_id, relation, linked_by)
      values (v_entry_id, p_submission_id, 'primary', p_actor);
    end if;
  else
    update canonical_entries set
      canonical_word = v_word,
      canonical_word_search_key = v_word_key,
      canonical_dialect_id = p_dialect_id,
      canonical_msa_synonyms = v_synonyms,
      canonical_explanation = v_explanation,
      editorial_status = 'approved',
      public_visibility = p_visibility,
      approved_by = p_actor,
      approved_at = now(),
      version = version + 1
    where id = v_entry_id;
  end if;

  -- Copy every raw example onto the canonical entry. Idempotent (re-approving
  -- never duplicates an example already carried over) and additive (never
  -- removes an example an admin already curated via the merge workspace).
  insert into canonical_examples (canonical_entry_id, sentence, sentence_search_key, source_raw_example_id, position)
  select v_entry_id, re.sentence, re.sentence_search_key, re.id, re.position
  from raw_examples re
  where re.raw_submission_id = p_submission_id
  on conflict (canonical_entry_id, sentence_search_key) do nothing;

  update raw_word_submissions
  set review_status = 'approved'
  where raw_word_submissions.id = p_submission_id
  returning raw_word_submissions.updated_at into v_current;

  insert into review_events (raw_submission_id, canonical_entry_id, actor_id, action, before_state, after_state)
  values (
    p_submission_id, v_entry_id, p_actor, 'approve', v_before,
    jsonb_build_object(
      'review_status', 'approved', 'canonical_entry_id', v_entry_id,
      'canonical_dialect_id', p_dialect_id, 'public_visibility', p_visibility
    )
  );

  return query select v_entry_id, 'approved'::text, v_current, false, p_visibility;
end;
$$;

grant execute on function approve_raw_submission(uuid, uuid, uuid, timestamptz, boolean, text, text, text[], text, text) to authenticated;

create or replace function bulk_approve_submissions(
  p_actor uuid,
  p_items jsonb, -- [{ "submission_id": uuid, "dialect_id": uuid, "expected_updated_at": timestamptz|null }, ...]
  p_visibility text
)
returns table (
  submission_id uuid,
  status text, -- 'approved' | 'conflict' | 'failed'
  entry_id uuid,
  error_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_submission_id uuid;
  v_dialect_id uuid;
  v_expected timestamptz;
  v_result record;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_visibility not in ('public', 'private') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_submission_id := nullif(v_item ->> 'submission_id', '')::uuid;
    v_dialect_id := nullif(v_item ->> 'dialect_id', '')::uuid;
    v_expected := nullif(v_item ->> 'expected_updated_at', '')::timestamptz;

    begin
      select * into v_result
      from approve_raw_submission(
        p_actor, v_submission_id, v_dialect_id, v_expected,
        true, null, null, null, null, p_visibility
      );

      submission_id := v_submission_id;
      entry_id := v_result.entry_id;
      if v_result.stale then
        status := 'conflict';
        error_code := 'STALE_VERSION';
      else
        status := 'approved';
        error_code := null;
      end if;
      return next;
    exception when others then
      submission_id := v_submission_id;
      entry_id := null;
      status := 'failed';
      error_code := case sqlerrm
        when 'not_authorized' then 'NOT_AUTHORIZED'
        when 'invalid_dialect' then 'INVALID_DIALECT'
        when 'dialect_required' then 'DIALECT_REQUIRED'
        when 'invalid_visibility' then 'INVALID_VISIBILITY'
        when 'not_found' then 'SUBMISSION_NOT_FOUND'
        else 'UNKNOWN_ERROR'
      end;
      return next;
    end;
  end loop;
end;
$$;

grant execute on function bulk_approve_submissions(uuid, jsonb, text) to authenticated;

-- Classification-only counterpart, same one-round-trip / per-row-safe shape.
create or replace function bulk_classify_submissions(
  p_actor uuid,
  p_items jsonb -- [{ "submission_id": uuid, "dialect_id": uuid }, ...]
)
returns table (
  submission_id uuid,
  status text, -- 'approved' | 'failed'  (classification has no optimistic-concurrency precondition, so no 'conflict')
  entry_id uuid,
  error_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_submission_id uuid;
  v_dialect_id uuid;
  v_entry_id uuid;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_submission_id := nullif(v_item ->> 'submission_id', '')::uuid;
    v_dialect_id := nullif(v_item ->> 'dialect_id', '')::uuid;

    begin
      select classify_submission(p_actor, v_submission_id, v_dialect_id) into v_entry_id;
      submission_id := v_submission_id;
      entry_id := v_entry_id;
      status := 'approved';
      error_code := null;
      return next;
    exception when others then
      submission_id := v_submission_id;
      entry_id := null;
      status := 'failed';
      error_code := case sqlerrm
        when 'not_authorized' then 'NOT_AUTHORIZED'
        when 'invalid_dialect' then 'INVALID_DIALECT'
        when 'dialect_required' then 'DIALECT_REQUIRED'
        when 'not_found' then 'SUBMISSION_NOT_FOUND'
        else 'UNKNOWN_ERROR'
      end;
      return next;
    end;
  end loop;
end;
$$;

grant execute on function bulk_classify_submissions(uuid, jsonb) to authenticated;

-- Make sure PostgREST picks up both new signatures immediately rather than
-- waiting for its next periodic schema-cache reload.
notify pgrst, 'reload schema';
