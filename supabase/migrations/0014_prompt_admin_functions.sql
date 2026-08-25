-- Admin prompt management. Update-only (no insert/delete path): new
-- prompts arrive exclusively through the deterministic seed (0015), and
-- deactivation (is_active = false) is how an admin retires a prompt without
-- ever breaking historical submission snapshots or the entry_sources chain.
create or replace function upsert_reference_prompt(
  p_actor uuid,
  p_id text,
  p_expected_prompt_version integer,
  p_category text,
  p_category_label_ar text,
  p_msa_lemma text,
  p_definition_ar text,
  p_scenario_ar text,
  p_part_of_speech text,
  p_answer_form text,
  p_priority integer,
  p_is_active boolean
)
returns table (id text, prompt_version integer, stale boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_version integer;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select reference_prompts.prompt_version into v_current_version
  from reference_prompts where reference_prompts.id = p_id
  for update;

  if v_current_version is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_expected_prompt_version is not null and v_current_version <> p_expected_prompt_version then
    return query select p_id, v_current_version, true;
    return;
  end if;

  update reference_prompts set
    category = p_category,
    category_label_ar = p_category_label_ar,
    msa_lemma = p_msa_lemma,
    definition_ar = p_definition_ar,
    scenario_ar = p_scenario_ar,
    part_of_speech = p_part_of_speech,
    answer_form = p_answer_form,
    priority = p_priority,
    is_active = p_is_active,
    prompt_version = reference_prompts.prompt_version + 1
  where reference_prompts.id = p_id
  returning reference_prompts.prompt_version into v_current_version;

  return query select p_id, v_current_version, false;
end;
$$;

grant execute on function upsert_reference_prompt(uuid, text, integer, text, text, text, text, text, text, text, integer, boolean) to authenticated;

-- Submission counts per prompt, for the admin table ("identify prompts with
-- no submissions"). Counts raw submissions regardless of review status —
-- this is an editorial/coverage signal, not the public leaderboard.
create or replace function reference_prompt_submission_counts(p_actor uuid)
returns table (reference_prompt_id text, submission_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return query
    select rws.reference_prompt_id, count(*)
    from raw_word_submissions rws
    where rws.reference_prompt_id is not null
    group by rws.reference_prompt_id;
end;
$$;

grant execute on function reference_prompt_submission_counts(uuid) to authenticated;
