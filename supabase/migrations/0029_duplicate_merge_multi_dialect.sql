-- Multi-dialect duplicate merging: reuses canonical_entry_dialects (0027)
-- for the merge flow, the same way update_canonical_entry_full() already
-- does. Does not replace or remove that table or its existing behavior —
-- canonical_dialect_id remains the synchronized "primary" value every
-- other query (v1/v2/v3 export, approve/merge, RLS-adjacent joins) reads.
--
-- Also makes a merge fully undoable through the same
-- undo_canonical_entry_edit() (0028) machinery the dictionary editor uses,
-- by recording the same rich before/after snapshot under the 'edit_full'
-- action instead of the old flat 'duplicate_group_merge' snapshot.

-- --- 1. duplicate_group_members(): expose each candidate's full dialect set

drop function if exists duplicate_group_members(text);

create or replace function duplicate_group_members(p_group_key text)
returns table (
  member_type text,
  member_id uuid,
  word text,
  dialect_id uuid,
  dialect_ids uuid[],
  main_group_code text,
  local_dialect_label text,
  meaning text,
  msa_synonyms text[],
  examples jsonb,
  related_words text[],
  concept_id text,
  register text,
  public_visibility text,
  reference_prompt_id text,
  version integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not is_active_admin(auth.uid()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return query
  with target_ids as (
    select unnest(dgc.member_ids) as member_id
    from duplicate_group_candidates(null, null, null, null, null, null, 'newest', 2147483647, 0) dgc
    where dgc.group_key = p_group_key
  )
  -- Raw candidates: a single selected dialect each (dialect_ids is a
  -- one-element array for uniform client-side handling).
  select
    'raw'::text, r.id, r.submitted_word,
    r.selected_dialect_id,
    case when r.selected_dialect_id is not null then array[r.selected_dialect_id] else array[]::uuid[] end,
    d.main_group_code,
    case when d.parent_id is not null then d.name_ar else null end,
    r.submitted_explanation,
    case when r.submitted_msa_synonym is not null and length(trim(r.submitted_msa_synonym)) > 0
      then array[r.submitted_msa_synonym] else array[]::text[] end,
    coalesce((select jsonb_agg(jsonb_build_object('id', re.id, 'sentence', re.sentence) order by re.position) from raw_examples re where re.raw_submission_id = r.id), '[]'::jsonb),
    null::text[], null::text, null::text, null::text, r.reference_prompt_id, null::integer
  from raw_word_submissions r
  left join dialects d on d.id = r.selected_dialect_id
  where r.id in (select member_id from target_ids)
    and r.review_status in ('new', 'pending', 'approved', 'merged')
  union all
  -- Canonical candidates: the *complete* preserved dialect set — the same
  -- union-with-primary rule dictionary_entry_detail() (0027) and the v4
  -- export use, so "preserve existing dialect assignments" always sees
  -- every dialect the entry actually has, not just canonical_dialect_id.
  select
    'canonical'::text, c.id, c.canonical_word,
    c.canonical_dialect_id,
    (select array_agg(distinct dialect_id) from (
      select c.canonical_dialect_id as dialect_id
      union
      select ced.dialect_id from canonical_entry_dialects ced where ced.canonical_entry_id = c.id
    ) all_ids),
    d.main_group_code,
    case when d.parent_id is not null then d.name_ar else null end,
    c.canonical_explanation, coalesce(c.canonical_msa_synonyms, array[]::text[]),
    coalesce((select jsonb_agg(jsonb_build_object('id', ce.id, 'sentence', ce.sentence) order by ce.position) from canonical_examples ce where ce.canonical_entry_id = c.id), '[]'::jsonb),
    c.related_words, c.concept_id, c.register, c.public_visibility, c.reference_prompt_id, c.version
  from canonical_entries c
  left join dialects d on d.id = c.canonical_dialect_id
  where c.id in (select member_id from target_ids);
end;
$$;

grant execute on function duplicate_group_members(text) to authenticated;

-- --- 2. merge_duplicate_group(): multi-dialect + full-fidelity undo -------

drop function if exists merge_duplicate_group(
  uuid, text, text, uuid[], uuid, integer, text, text, uuid, text[], text, jsonb, uuid[], text[], text, text, text, text
);

create or replace function merge_duplicate_group(
  p_actor uuid,
  p_group_key text,
  p_member_signature text,
  p_raw_submission_ids uuid[],
  p_target_entry_id uuid,
  p_expected_version integer,
  p_canonical_word text,
  p_canonical_word_search_key text,
  p_dialect_ids uuid[],
  p_canonical_msa_synonyms text[],
  p_canonical_explanation text,
  p_examples jsonb,
  p_removed_canonical_example_ids uuid[] default '{}',
  p_related_words text[] default '{}',
  p_concept_id text default null,
  p_register text default null,
  p_visibility text default 'public',
  p_reference_prompt_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_entry_id uuid;
  v_current_version integer;
  v_before jsonb;
  v_after jsonb;
  v_primary_dialect uuid;
  v_raw_id uuid;
  v_removed_id uuid;
  v_dialect_id uuid;
  v_example jsonb;
  v_is_first boolean := true;
  v_lock_key text;
  v_fresh_signature text;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if array_length(p_raw_submission_ids, 1) is null and p_target_entry_id is null then
    raise exception 'no_sources' using errcode = '22023';
  end if;
  if array_length(p_dialect_ids, 1) is null or array_length(p_dialect_ids, 1) < 1 then
    raise exception 'dialect_required' using errcode = '22023';
  end if;
  if p_register is not null and p_register not in ('neutral', 'informal', 'slang', 'offensive', 'taboo', 'archaic') then
    raise exception 'invalid_register' using errcode = '22023';
  end if;

  -- Serialize concurrent merges of the same group: ensure a resolution row
  -- exists, then lock it. A second concurrent call blocks here until the
  -- first commits, then sees the group already 'merged' below.
  insert into duplicate_group_resolutions (group_key, status)
  values (p_group_key, 'unresolved')
  on conflict (group_key) do nothing;

  select status into v_lock_key from duplicate_group_resolutions where group_key = p_group_key for update;

  if v_lock_key = 'merged' then
    raise exception 'already_merged' using errcode = '40001';
  end if;

  v_primary_dialect := p_dialect_ids[1];

  if p_target_entry_id is null then
    insert into canonical_entries (
      canonical_word, canonical_word_search_key, canonical_dialect_id,
      canonical_msa_synonyms, canonical_explanation, editorial_status,
      approved_by, approved_at, reference_prompt_id,
      related_words, concept_id, register, public_visibility
    ) values (
      p_canonical_word, p_canonical_word_search_key, v_primary_dialect,
      p_canonical_msa_synonyms, nullif(p_canonical_explanation, ''), 'approved', p_actor, now(),
      p_reference_prompt_id, coalesce(p_related_words, '{}'), p_concept_id, p_register,
      coalesce(p_visibility, 'public')
    )
    returning id into v_entry_id;
    -- No before_state: the entry didn't exist yet, so there is nothing to
    -- restore to — undo_canonical_entry_edit() correctly reports
    -- 'nothing_to_undo' if attempted on this event.
    v_before := null;
  else
    v_entry_id := p_target_entry_id;

    -- Full before-state (same shape update_canonical_entry_full() uses) —
    -- row, dialect set, and example list — captured under the row lock so
    -- undoing this merge later can restore everything it's about to change.
    select
      jsonb_build_object(
        'entry', to_jsonb(canonical_entries.*),
        'dialect_ids', coalesce(
          (select jsonb_agg(ced.dialect_id) from canonical_entry_dialects ced where ced.canonical_entry_id = v_entry_id),
          '[]'::jsonb
        ),
        'examples', coalesce(
          (select jsonb_agg(jsonb_build_object(
              'id', ce.id, 'sentence', ce.sentence, 'sentence_search_key', ce.sentence_search_key,
              'source_raw_example_id', ce.source_raw_example_id, 'position', ce.position
            ) order by ce.position)
           from canonical_examples ce where ce.canonical_entry_id = v_entry_id),
          '[]'::jsonb
        )
      ),
      canonical_entries.version
    into v_before, v_current_version
    from canonical_entries where canonical_entries.id = v_entry_id for update;

    if v_current_version is null then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    if p_expected_version is not null and v_current_version <> p_expected_version then
      raise exception 'stale_version' using errcode = '40001';
    end if;

    update canonical_entries set
      canonical_word = p_canonical_word,
      canonical_word_search_key = p_canonical_word_search_key,
      canonical_dialect_id = v_primary_dialect,
      canonical_msa_synonyms = p_canonical_msa_synonyms,
      canonical_explanation = nullif(p_canonical_explanation, ''),
      editorial_status = 'approved',
      version = canonical_entries.version + 1,
      approved_by = p_actor,
      approved_at = now(),
      reference_prompt_id = coalesce(canonical_entries.reference_prompt_id, p_reference_prompt_id),
      related_words = coalesce(p_related_words, canonical_entries.related_words),
      concept_id = coalesce(p_concept_id, canonical_entries.concept_id),
      register = coalesce(p_register, canonical_entries.register),
      public_visibility = coalesce(p_visibility, canonical_entries.public_visibility)
    where canonical_entries.id = v_entry_id;
  end if;

  -- Write the complete selected dialect set — every main group and local
  -- dialect the admin chose, transactionally, alongside canonical_dialect_id.
  delete from canonical_entry_dialects where canonical_entry_id = v_entry_id;
  foreach v_dialect_id in array p_dialect_ids loop
    insert into canonical_entry_dialects (canonical_entry_id, dialect_id)
    values (v_entry_id, v_dialect_id)
    on conflict do nothing;
  end loop;

  foreach v_raw_id in array coalesce(p_raw_submission_ids, '{}') loop
    insert into entry_sources (canonical_entry_id, raw_submission_id, relation, linked_by)
    values (v_entry_id, v_raw_id, case when v_is_first then 'primary' else 'merged' end, p_actor)
    on conflict (canonical_entry_id, raw_submission_id) do nothing;

    update raw_word_submissions set review_status = 'merged' where id = v_raw_id;
    v_is_first := false;
  end loop;

  foreach v_removed_id in array coalesce(p_removed_canonical_example_ids, '{}') loop
    delete from canonical_examples where id = v_removed_id and canonical_entry_id = v_entry_id;
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
    on conflict (canonical_entry_id, sentence_search_key) do update set
      position = excluded.position;
  end loop;

  -- Merging just added/updated a canonical_entries row, which itself joins
  -- this same word_search_key group as a new member — so the group's true
  -- post-merge signature differs from the pre-merge one the client
  -- computed. Recompute it fresh so the group correctly reads as resolved
  -- on the very next fetch instead of immediately auto-reopening against
  -- its own new membership.
  select md5(array_to_string(dgc.member_ids, ','))
    into v_fresh_signature
  from duplicate_group_candidates(null, null, null, null, null, null, 'newest', 2147483647, 0) dgc
  where dgc.group_key = p_group_key;

  update duplicate_group_resolutions
  set status = 'merged', member_signature = coalesce(v_fresh_signature, p_member_signature),
      canonical_entry_id = v_entry_id,
      resolved_by = p_actor, resolved_at = now(), updated_at = now()
  where group_key = p_group_key;

  select jsonb_build_object(
    'entry', to_jsonb(c.*),
    'dialect_ids', coalesce((select jsonb_agg(ced.dialect_id) from canonical_entry_dialects ced where ced.canonical_entry_id = v_entry_id), '[]'::jsonb),
    'examples', coalesce(
      (select jsonb_agg(jsonb_build_object(
          'id', ce.id, 'sentence', ce.sentence, 'sentence_search_key', ce.sentence_search_key,
          'source_raw_example_id', ce.source_raw_example_id, 'position', ce.position
        ) order by ce.position)
       from canonical_examples ce where ce.canonical_entry_id = v_entry_id),
      '[]'::jsonb
    )
  ) into v_after
  from canonical_entries c where c.id = v_entry_id;

  -- Logged as 'edit_full' (not the old 'duplicate_group_merge') so this
  -- merge is undoable through the same undo_canonical_entry_edit() (0028)
  -- every dictionary-editor edit already uses — full dialect set and
  -- example list restored, not just scalar fields.
  insert into review_events (canonical_entry_id, actor_id, action, before_state, after_state)
  values (v_entry_id, p_actor, 'edit_full', v_before, v_after);

  return v_entry_id;
end;
$$;

grant execute on function merge_duplicate_group(
  uuid, text, text, uuid[], uuid, integer, text, text, uuid[], text[], text, jsonb, uuid[], text[], text, text, text, text
) to authenticated;
