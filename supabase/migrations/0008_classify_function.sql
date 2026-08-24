-- Applies a canonical dialect to a raw submission without approving it.
-- Creates (or reuses) the submission's primary-linked canonical draft entry
-- and updates its dialect only; the submitted_dialect on the raw row is
-- never touched (submitted vs. canonical stay separate — data-model.md).
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
