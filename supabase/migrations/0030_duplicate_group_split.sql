-- Duplicate-management correction: two words that share a meaning (or a
-- similar spelling) are not automatically the same word. Concretely, "جب"
-- (Najdi) and "جيب" (Hijazi) may land in the same fuzzy/possible-match
-- duplicate group because they are spelled similarly and mean the same
-- thing, but they are different dialect-specific word forms and must never
-- be forced into one canonical entry just because a group surfaced them
-- together.
--
-- This adds "فصل إلى كلمات مستقلة" (split into independent words): a group
-- action that creates or preserves one canonical entry PER distinct
-- word_key the admin defines from the group's members, each keeping its
-- own word_key, dialect assignment, and related_words independently, while
-- optionally linking every resulting entry with the same admin-set
-- concept_id to record that they share a meaning. It never merges the
-- group's sources into a single canonical_entries row.

alter table duplicate_group_resolutions
  drop constraint if exists duplicate_group_resolutions_status_check;

alter table duplicate_group_resolutions
  add constraint duplicate_group_resolutions_status_check
    check (status in ('unresolved', 'not_duplicate', 'ignored', 'merged', 'split'));

create or replace function split_duplicate_group_words(
  p_actor uuid,
  p_group_key text,
  p_member_signature text,
  p_words jsonb,
  p_concept_id text default null
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_word jsonb;
  v_entry_id uuid;
  v_entry_ids uuid[] := '{}';
  v_current_version integer;
  v_dialect_ids uuid[];
  v_dialect_id uuid;
  v_primary_dialect uuid;
  v_raw_id uuid;
  v_removed_id uuid;
  v_example jsonb;
  v_target_entry_id uuid;
  v_is_first boolean;
  v_lock_key text;
  v_fresh_signature text;
  v_seen_keys text[] := '{}';
  v_word_key text;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_words is null or jsonb_array_length(p_words) < 2 then
    raise exception 'at_least_two_words_required' using errcode = '22023';
  end if;

  -- Serialize concurrent resolution of the same group, same as
  -- merge_duplicate_group().
  insert into duplicate_group_resolutions (group_key, status)
  values (p_group_key, 'unresolved')
  on conflict (group_key) do nothing;

  select status into v_lock_key from duplicate_group_resolutions where group_key = p_group_key for update;

  if v_lock_key in ('merged', 'split') then
    raise exception 'already_resolved' using errcode = '40001';
  end if;

  for v_word in select * from jsonb_array_elements(p_words)
  loop
    v_word_key := v_word ->> 'wordSearchKey';

    -- Different word_key values must remain separate canonical words: never
    -- collapse two specs of this same split into one entry.
    if v_word_key is null or length(trim(v_word_key)) = 0 then
      raise exception 'word_key_required' using errcode = '22023';
    end if;
    if v_word_key = any(v_seen_keys) then
      raise exception 'duplicate_word_key_in_split' using errcode = '22023';
    end if;
    v_seen_keys := array_append(v_seen_keys, v_word_key);

    v_dialect_ids := coalesce(
      (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_word -> 'dialectIds', '[]'::jsonb)) x),
      '{}'::uuid[]
    );
    if array_length(v_dialect_ids, 1) is null then
      raise exception 'dialect_required' using errcode = '22023';
    end if;
    v_primary_dialect := v_dialect_ids[1];

    v_target_entry_id := nullif(v_word ->> 'targetEntryId', '')::uuid;

    if v_target_entry_id is null then
      insert into canonical_entries (
        canonical_word, canonical_word_search_key, canonical_dialect_id,
        canonical_msa_synonyms, canonical_explanation, editorial_status,
        approved_by, approved_at, reference_prompt_id,
        related_words, concept_id, register, public_visibility
      ) values (
        v_word ->> 'word', v_word_key, v_primary_dialect,
        coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(v_word -> 'msaSynonyms', '[]'::jsonb)) x), '{}'),
        nullif(v_word ->> 'explanation', ''), 'approved', p_actor, now(),
        nullif(v_word ->> 'referencePromptId', ''),
        coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(v_word -> 'relatedWords', '[]'::jsonb)) x), '{}'),
        coalesce(p_concept_id, nullif(v_word ->> 'conceptId', '')),
        nullif(v_word ->> 'register', ''),
        coalesce(nullif(v_word ->> 'visibility', ''), 'public')
      )
      returning id into v_entry_id;
    else
      v_entry_id := v_target_entry_id;
      select version into v_current_version from canonical_entries where id = v_entry_id for update;
      if v_current_version is null then
        raise exception 'not_found' using errcode = 'P0002';
      end if;
      if (v_word ->> 'expectedVersion') is not null
        and v_current_version <> (v_word ->> 'expectedVersion')::integer then
        raise exception 'stale_version' using errcode = '40001';
      end if;

      update canonical_entries set
        canonical_word = v_word ->> 'word',
        canonical_word_search_key = v_word_key,
        canonical_dialect_id = v_primary_dialect,
        canonical_msa_synonyms = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(v_word -> 'msaSynonyms', '[]'::jsonb)) x), '{}'),
        canonical_explanation = nullif(v_word ->> 'explanation', ''),
        editorial_status = 'approved',
        version = canonical_entries.version + 1,
        approved_by = p_actor,
        approved_at = now(),
        reference_prompt_id = coalesce(canonical_entries.reference_prompt_id, nullif(v_word ->> 'referencePromptId', '')),
        related_words = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(v_word -> 'relatedWords', '[]'::jsonb)) x), canonical_entries.related_words),
        concept_id = coalesce(p_concept_id, nullif(v_word ->> 'conceptId', ''), canonical_entries.concept_id),
        register = coalesce(nullif(v_word ->> 'register', ''), canonical_entries.register),
        public_visibility = coalesce(nullif(v_word ->> 'visibility', ''), canonical_entries.public_visibility)
      where canonical_entries.id = v_entry_id;
    end if;

    -- Preserve this word's dialect assignment independently of every other
    -- word produced by this same split — never shared, never unioned.
    delete from canonical_entry_dialects where canonical_entry_id = v_entry_id;
    foreach v_dialect_id in array v_dialect_ids loop
      insert into canonical_entry_dialects (canonical_entry_id, dialect_id)
      values (v_entry_id, v_dialect_id)
      on conflict do nothing;
    end loop;

    v_is_first := true;
    for v_raw_id in
      select x::uuid from jsonb_array_elements_text(coalesce(v_word -> 'rawSubmissionIds', '[]'::jsonb)) x
    loop
      insert into entry_sources (canonical_entry_id, raw_submission_id, relation, linked_by)
      values (v_entry_id, v_raw_id, case when v_is_first then 'primary' else 'merged' end, p_actor)
      on conflict (canonical_entry_id, raw_submission_id) do nothing;

      update raw_word_submissions set review_status = 'merged' where id = v_raw_id;
      v_is_first := false;
    end loop;

    for v_removed_id in
      select x::uuid from jsonb_array_elements_text(coalesce(v_word -> 'removedCanonicalExampleIds', '[]'::jsonb)) x
    loop
      delete from canonical_examples where id = v_removed_id and canonical_entry_id = v_entry_id;
    end loop;

    for v_example in select * from jsonb_array_elements(coalesce(v_word -> 'examples', '[]'::jsonb))
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

    insert into review_events (canonical_entry_id, actor_id, action, before_state, after_state)
    values (
      v_entry_id, p_actor, 'duplicate_group_split',
      null,
      jsonb_build_object(
        'group_key', p_group_key,
        'canonical_entry_id', v_entry_id,
        'word_key', v_word_key,
        'concept_id', coalesce(p_concept_id, nullif(v_word ->> 'conceptId', '')),
        'dialect_ids', to_jsonb(v_dialect_ids)
      )
    );

    v_entry_ids := array_append(v_entry_ids, v_entry_id);
  end loop;

  -- Same reasoning as merge_duplicate_group(): the group now also contains
  -- the newly-produced canonical entries as members, so its true post-split
  -- signature differs from the pre-split one the client computed.
  -- canonical_entry_id is left null on this row since a split intentionally
  -- produces more than one canonical entry — no single id represents it.
  select md5(array_to_string(dgc.member_ids, ','))
    into v_fresh_signature
  from duplicate_group_candidates(null, null, null, null, null, null, 'newest', 2147483647, 0) dgc
  where dgc.group_key = p_group_key;

  update duplicate_group_resolutions
  set status = 'split', member_signature = coalesce(v_fresh_signature, p_member_signature),
      canonical_entry_id = null,
      resolved_by = p_actor, resolved_at = now(), updated_at = now()
  where group_key = p_group_key;

  return v_entry_ids;
end;
$$;

grant execute on function split_duplicate_group_words(uuid, text, text, jsonb, text) to authenticated;
