-- Fixes a confirmed production bug: "approve" and "classify" were two
-- disconnected actions. classify_submission() creates a canonical_entries
-- row with editorial_status = 'draft'; the admin UI's "اعتماد" (approve)
-- button called review_raw_submission(), which only ever flips
-- raw_word_submissions.review_status — it never promoted the linked
-- canonical entry to 'approved' and never copied the raw submission's
-- examples into canonical_examples. Result: a raw submission could show
-- "معتمد" (approved) in the admin grid while remaining permanently
-- invisible to export (editorial_status stuck at 'draft', zero examples).
--
-- approve_raw_submission() replaces that two-step flow with one atomic,
-- secure, optimistic-concurrency transaction that:
--   1. requires a dialect classification (an approved word must be classified),
--   2. creates or promotes the linked canonical entry to 'approved',
--   3. copies every one of the raw submission's examples into
--      canonical_examples (idempotent — on conflict do nothing),
--   4. flips raw_word_submissions.review_status to 'approved',
--   5. records one 'approve' review event.
--
-- review_raw_submission() no longer accepts 'approved' as a target status,
-- so this defect class cannot recur even if a future UI change calls the
-- wrong function.

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
  -- 'approved' is intentionally excluded: approving a word must go through
  -- approve_raw_submission(), which also canonicalizes it. A bare status
  -- flip here would silently produce a non-exportable "approved" record
  -- (the exact bug this migration fixes).
  if p_new_status not in ('pending', 'rejected', 'duplicate') then
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

-- p_use_raw_defaults = true (the grid's bulk "اعتماد"): canonical word,
-- synonyms, and explanation are always taken from the raw submission as-is
-- — there is no per-row edit UI in the bulk flow.
-- p_use_raw_defaults = false (ReviewDetail's edit-then-approve flow): the
-- explicit p_canonical_* values are used instead, matching what the admin
-- edited on screen.
create or replace function approve_raw_submission(
  p_actor uuid,
  p_submission_id uuid,
  p_dialect_id uuid,
  p_expected_updated_at timestamptz,
  p_use_raw_defaults boolean default true,
  p_canonical_word text default null,
  p_canonical_word_search_key text default null,
  p_canonical_msa_synonyms text[] default null,
  p_canonical_explanation text default null
)
returns table (entry_id uuid, review_status text, updated_at timestamptz, stale boolean)
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

  select * into v_raw from raw_word_submissions where raw_word_submissions.id = p_submission_id for update;
  if v_raw.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_expected_updated_at is not null and v_raw.updated_at <> p_expected_updated_at then
    return query select null::uuid, v_raw.review_status, v_raw.updated_at, true;
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
      approved_by, approved_at, reference_prompt_id
    ) values (
      v_word, v_word_key, p_dialect_id, v_synonyms, v_explanation, 'approved',
      p_actor, now(), v_raw.reference_prompt_id
    )
    returning id into v_entry_id;

    insert into entry_sources (canonical_entry_id, raw_submission_id, relation, linked_by)
    values (v_entry_id, p_submission_id, 'primary', p_actor);
  else
    update canonical_entries set
      canonical_word = v_word,
      canonical_word_search_key = v_word_key,
      canonical_dialect_id = p_dialect_id,
      canonical_msa_synonyms = v_synonyms,
      canonical_explanation = v_explanation,
      editorial_status = 'approved',
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
    jsonb_build_object('review_status', 'approved', 'canonical_entry_id', v_entry_id, 'canonical_dialect_id', p_dialect_id)
  );

  return query select v_entry_id, 'approved'::text, v_current, false;
end;
$$;

grant execute on function approve_raw_submission(uuid, uuid, uuid, timestamptz, boolean, text, text, text[], text) to authenticated;
