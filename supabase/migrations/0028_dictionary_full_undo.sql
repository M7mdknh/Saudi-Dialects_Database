-- Full-fidelity undo for the dictionary editor. update_canonical_entry_full()
-- (0027) recorded before_state as a flat to_jsonb() of the canonical_entries
-- row only, so the shared undo_review_event() could restore scalar columns
-- but never the entry's dialect set (canonical_entry_dialects) or its
-- example list (canonical_examples) — both relational, not columns on that
-- row. This migration:
--
--   1. Makes update_canonical_entry_full() snapshot a complete before-state
--      (entry columns + dialect_ids + full example list with ids,
--      positions, and provenance) and log it under a distinct action
--      ('edit_full') so the *existing* generic undo_review_event() — used
--      by raw-submission review, upsert_canonical_entry, and merge flows —
--      is completely untouched and keeps its current flat-snapshot
--      behavior for those action types.
--   2. Adds undo_canonical_entry_edit(), a dedicated, transactional,
--      optimistic-concurrency-checked restore for 'edit_full' events only.
--
-- Raw submissions/examples and entry_sources are never touched by either
-- function — restoring a canonical entry's example list only replaces rows
-- in canonical_examples (re-inserting each with its original id and
-- source_raw_example_id), never raw_examples, so provenance is preserved.

create or replace function update_canonical_entry_full(
  p_actor uuid,
  p_entry_id uuid,
  p_expected_version integer,
  p_canonical_word text,
  p_canonical_word_search_key text,
  p_canonical_explanation text,
  p_canonical_msa_synonyms text[],
  p_dialect_ids uuid[],
  p_examples jsonb,
  p_related_words text[],
  p_concept_id text,
  p_register text,
  p_visibility text
)
returns table (id uuid, version integer, stale boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_before jsonb;
  v_current_version integer;
  v_primary_dialect uuid;
  v_example jsonb;
  v_keep_ids uuid[];
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if array_length(p_dialect_ids, 1) is null or array_length(p_dialect_ids, 1) < 1 then
    raise exception 'dialect_required' using errcode = '22023';
  end if;
  if p_canonical_word is null or length(trim(p_canonical_word)) = 0 then
    raise exception 'word_required' using errcode = '22023';
  end if;
  if p_register is not null and p_register not in ('neutral', 'informal', 'slang', 'offensive', 'taboo', 'archaic') then
    raise exception 'invalid_register' using errcode = '22023';
  end if;
  if p_visibility is not null and p_visibility not in ('public', 'private') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;

  -- Full before-state: the row itself, its complete dialect-id set, and its
  -- complete example list (id, sentence, search key, source, position) —
  -- everything update_canonical_entry_full() can change, in exact restorable
  -- form. Locks the row (for update) so a concurrent editor save/undo
  -- serializes behind this one.
  select
    jsonb_build_object(
      'entry', to_jsonb(canonical_entries.*),
      'dialect_ids', coalesce(
        (select jsonb_agg(ced.dialect_id) from canonical_entry_dialects ced where ced.canonical_entry_id = p_entry_id),
        '[]'::jsonb
      ),
      'examples', coalesce(
        (select jsonb_agg(jsonb_build_object(
            'id', ce.id, 'sentence', ce.sentence, 'sentence_search_key', ce.sentence_search_key,
            'source_raw_example_id', ce.source_raw_example_id, 'position', ce.position
          ) order by ce.position)
         from canonical_examples ce where ce.canonical_entry_id = p_entry_id),
        '[]'::jsonb
      )
    ),
    canonical_entries.version
  into v_before, v_current_version
  from canonical_entries where canonical_entries.id = p_entry_id for update;

  if v_current_version is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_expected_version is not null and v_current_version <> p_expected_version then
    return query select p_entry_id, v_current_version, true;
    return;
  end if;

  v_primary_dialect := p_dialect_ids[1];

  update canonical_entries set
    canonical_word = p_canonical_word,
    canonical_word_search_key = p_canonical_word_search_key,
    canonical_dialect_id = v_primary_dialect,
    canonical_explanation = nullif(p_canonical_explanation, ''),
    canonical_msa_synonyms = coalesce(p_canonical_msa_synonyms, '{}'),
    related_words = coalesce(p_related_words, '{}'),
    concept_id = p_concept_id,
    register = p_register,
    public_visibility = coalesce(p_visibility, canonical_entries.public_visibility),
    editorial_status = 'approved',
    version = canonical_entries.version + 1,
    updated_at = now()
  where canonical_entries.id = p_entry_id;

  delete from canonical_entry_dialects where canonical_entry_id = p_entry_id;
  insert into canonical_entry_dialects (canonical_entry_id, dialect_id)
  select p_entry_id, d from unnest(p_dialect_ids) as d
  on conflict do nothing;

  select array_agg((e ->> 'id')::uuid) into v_keep_ids
  from jsonb_array_elements(coalesce(p_examples, '[]'::jsonb)) e
  where (e ->> 'id') is not null;

  delete from canonical_examples
  where canonical_entry_id = p_entry_id
    and not (canonical_examples.id = any(coalesce(v_keep_ids, '{}')));

  for v_example in select * from jsonb_array_elements(coalesce(p_examples, '[]'::jsonb))
  loop
    if (v_example ->> 'id') is not null
       and exists (select 1 from canonical_examples ce where ce.id = (v_example ->> 'id')::uuid) then
      update canonical_examples set
        sentence = v_example ->> 'sentence',
        sentence_search_key = v_example ->> 'sentenceSearchKey',
        position = coalesce((v_example ->> 'position')::integer, 0),
        updated_at = now()
      where canonical_examples.id = (v_example ->> 'id')::uuid;
    else
      insert into canonical_examples (
        canonical_entry_id, sentence, sentence_search_key, source_raw_example_id, position
      ) values (
        p_entry_id,
        v_example ->> 'sentence',
        v_example ->> 'sentenceSearchKey',
        nullif(v_example ->> 'sourceRawExampleId', '')::uuid,
        coalesce((v_example ->> 'position')::integer, 0)
      )
      on conflict (canonical_entry_id, sentence_search_key) do update set position = excluded.position;
    end if;
  end loop;

  insert into review_events (canonical_entry_id, actor_id, action, before_state, after_state)
  values (
    p_entry_id, p_actor, 'edit_full', v_before,
    to_jsonb((select ce from canonical_entries ce where ce.id = p_entry_id))
  );

  return query select p_entry_id, v_current_version + 1, false;
end;
$$;

grant execute on function update_canonical_entry_full(
  uuid, uuid, integer, text, text, text, text[], uuid[], jsonb, text[], text, text, text
) to authenticated;

-- --- Dedicated full-fidelity undo for 'edit_full' events ------------------

create or replace function undo_canonical_entry_edit(
  p_actor uuid,
  p_event_id uuid,
  p_expected_version integer default null
)
returns table (id uuid, version integer, stale boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_event review_events%rowtype;
  v_current_version integer;
  v_entry_id uuid;
  v_dialect_id uuid;
  v_example jsonb;
  v_after jsonb;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_event from review_events where id = p_event_id;
  if v_event.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_event.action <> 'edit_full' or v_event.canonical_entry_id is null or v_event.before_state is null then
    raise exception 'nothing_to_undo' using errcode = '22023';
  end if;

  v_entry_id := v_event.canonical_entry_id;

  -- Lock the row and check optimistic concurrency the same way every other
  -- write in this feature does: undoing an edit that has since been
  -- superseded by a newer edit must be rejected, not silently clobber it.
  select canonical_entries.version into v_current_version
  from canonical_entries where canonical_entries.id = v_entry_id for update;

  if v_current_version is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_expected_version is not null and v_current_version <> p_expected_version then
    return query select v_entry_id, v_current_version, true;
    return;
  end if;

  update canonical_entries set
    canonical_word = coalesce(v_event.before_state -> 'entry' ->> 'canonical_word', canonical_word),
    canonical_word_search_key = coalesce(v_event.before_state -> 'entry' ->> 'canonical_word_search_key', canonical_word_search_key),
    canonical_dialect_id = coalesce((v_event.before_state -> 'entry' ->> 'canonical_dialect_id')::uuid, canonical_dialect_id),
    canonical_explanation = v_event.before_state -> 'entry' ->> 'canonical_explanation',
    canonical_msa_synonyms = coalesce(
      (select array_agg(x) from jsonb_array_elements_text(v_event.before_state -> 'entry' -> 'canonical_msa_synonyms') x),
      '{}'
    ),
    public_visibility = coalesce(v_event.before_state -> 'entry' ->> 'public_visibility', canonical_entries.public_visibility),
    related_words = coalesce(
      (select array_agg(x) from jsonb_array_elements_text(v_event.before_state -> 'entry' -> 'related_words') x),
      '{}'
    ),
    concept_id = v_event.before_state -> 'entry' ->> 'concept_id',
    register = v_event.before_state -> 'entry' ->> 'register',
    editorial_status = coalesce(v_event.before_state -> 'entry' ->> 'editorial_status', canonical_entries.editorial_status),
    version = canonical_entries.version + 1,
    updated_at = now()
  where canonical_entries.id = v_entry_id;

  -- Restore the exact prior dialect set.
  delete from canonical_entry_dialects where canonical_entry_id = v_entry_id;
  for v_dialect_id in
    select val::uuid from jsonb_array_elements_text(coalesce(v_event.before_state -> 'dialect_ids', '[]'::jsonb)) as x(val)
  loop
    insert into canonical_entry_dialects (canonical_entry_id, dialect_id)
    values (v_entry_id, v_dialect_id)
    on conflict do nothing;
  end loop;

  -- Restore the exact prior example list — same ids, sentences, positions,
  -- and source_raw_example_id provenance links as before the edit being
  -- undone. Only canonical_examples rows are replaced; raw_examples (the
  -- original contributor submissions) are never touched.
  delete from canonical_examples where canonical_entry_id = v_entry_id;
  for v_example in select * from jsonb_array_elements(coalesce(v_event.before_state -> 'examples', '[]'::jsonb))
  loop
    insert into canonical_examples (
      id, canonical_entry_id, sentence, sentence_search_key, source_raw_example_id, position
    ) values (
      (v_example ->> 'id')::uuid,
      v_entry_id,
      v_example ->> 'sentence',
      v_example ->> 'sentence_search_key',
      nullif(v_example ->> 'source_raw_example_id', '')::uuid,
      coalesce((v_example ->> 'position')::integer, 0)
    );
  end loop;

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

  insert into review_events (canonical_entry_id, actor_id, action, before_state, after_state)
  values (v_entry_id, p_actor, 'undo_edit_full', to_jsonb(v_event), v_after);

  return query select v_entry_id, v_current_version + 1, false;
end;
$$;

grant execute on function undo_canonical_entry_edit(uuid, uuid, integer) to authenticated;
