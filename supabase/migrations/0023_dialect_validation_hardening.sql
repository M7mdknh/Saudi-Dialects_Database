-- Independent server-side validation for the fast bulk-classification/
-- approval flow: the client (review/bulk-approve.ts) resolves each
-- submission's classification from its own selected_dialect_id /
-- provisional_main_group_code, but that resolution is only a proposal.
-- Previously, approve_raw_submission()/classify_submission() trusted
-- p_dialect_id purely via the FK constraint on canonical_entries /
-- canonical_dialect_id, which only guarantees the row exists — not that it
-- is still an active, valid classification (a dialect can be deactivated
-- between the client's preview and the actual approve call). Both
-- functions now re-validate p_dialect_id is an active dialect themselves,
-- independent of anything the client claims.

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

  if p_dialect_id is null then
    raise exception 'dialect_required' using errcode = '22023';
  end if;

  if not exists (select 1 from dialects where id = p_dialect_id and is_active = true) then
    raise exception 'invalid_dialect' using errcode = '22023';
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
      canonical_msa_synonyms, canonical_explanation, editorial_status
    ) values (
      v_raw.submitted_word, v_raw.word_search_key, p_dialect_id,
      array[v_raw.submitted_msa_synonym], v_raw.submitted_explanation, 'draft'
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

grant execute on function classify_submission(uuid, uuid, uuid) to authenticated;
