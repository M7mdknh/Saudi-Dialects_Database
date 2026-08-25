-- Turns the leaderboard from an approved-word count into an immediate
-- community-participation count, while keeping the public dictionary
-- (explorer/export) strictly approved-only. Two independent, both
-- authoritative numbers per main group:
--   submission_count      — legitimate stored raw submissions, counts the
--                            instant they're committed, regardless of
--                            review status, unless explicitly excluded.
--   approved_word_count   — unchanged definition: unique approved canonical
--                            words (see migration 0017).
--
-- Both are derived (never a mutable counter column) so they can never drift
-- from the underlying rows.

-- --- 1. Attribution columns on raw_word_submissions ----------------------

alter table raw_word_submissions
  add column if not exists selected_dialect_id uuid references dialects (id) on delete set null,
  add column if not exists provisional_main_group_code text
    check (provisional_main_group_code in ('hijazi', 'najdi', 'eastern', 'northern', 'southern')),
  add column if not exists admin_confirmed_main_group_code text
    check (admin_confirmed_main_group_code in ('hijazi', 'najdi', 'eastern', 'northern', 'southern')),
  -- Only these reasons remove a submission from submission_count. An
  -- ordinary/public rejection (review_status = 'rejected') is NOT one of
  -- them — participation and public-dictionary eligibility are separate
  -- decisions (see CLAUDE.md-adjacent product spec for this migration).
  add column if not exists participation_exclusion_reason text
    check (participation_exclusion_reason in ('spam', 'abuse', 'test', 'duplicate', 'invalid_submission'));

create index if not exists raw_word_submissions_selected_dialect_id_idx
  on raw_word_submissions (selected_dialect_id);
create index if not exists raw_word_submissions_participation_exclusion_idx
  on raw_word_submissions (participation_exclusion_reason);
-- Partial index on the common "does this row count?" predicate.
create index if not exists raw_word_submissions_counted_idx
  on raw_word_submissions (id) where participation_exclusion_reason is null;

-- No backfill guess for existing rows: selected_dialect_id,
-- provisional_main_group_code, and admin_confirmed_main_group_code all
-- default to NULL, which is exactly "unclassified" — correct for every
-- pre-existing row, which was free-text-only and must not be guessed into
-- one of the five groups (see product spec). All pre-existing rows keep
-- counting toward submission_count in aggregate (participation_exclusion_reason
-- defaults NULL, i.e. not excluded); they simply don't attribute to any of
-- the five group buckets until an admin classifies them.

-- --- 2. submit_batch: accept per-word dialect attribution ----------------

drop function if exists submit_batch(uuid, text, jsonb, text, timestamptz);

create or replace function submit_batch(
  p_idempotency_key uuid,
  p_consent_version text,
  p_words jsonb,
  p_abuse_hash text,
  p_abuse_hash_expires_at timestamptz
)
returns table (batch_id uuid, created boolean, affected_groups jsonb)
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
  v_dialect_id uuid;
  v_provisional_group text;
  v_affected_groups jsonb;
begin
  select id into v_batch_id from submission_batches where idempotency_key = p_idempotency_key;
  if v_batch_id is not null then
    -- Idempotent replay: +0 participation, same as the original response.
    return query select v_batch_id, false, '[]'::jsonb;
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

    -- Trust but verify: only an existing, active dialect id is honored.
    -- A stale/fabricated id silently falls back to the contributor's
    -- provisional group (never a hard failure over an attribution detail,
    -- and never creates a taxonomy row).
    v_dialect_id := nullif(v_word ->> 'dialectId', '')::uuid;
    if v_dialect_id is not null and not exists (
      select 1 from dialects where id = v_dialect_id and is_active = true
    ) then
      v_dialect_id := null;
    end if;

    v_provisional_group := nullif(v_word ->> 'provisionalMainGroupCode', '');

    insert into raw_word_submissions (
      batch_id, submitted_word, submitted_dialect, submitted_msa_synonym,
      submitted_explanation, word_search_key, dialect_search_key, position,
      reference_prompt_id, reference_prompt_snapshot,
      selected_dialect_id, provisional_main_group_code
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
      v_word -> 'referencePromptSnapshot',
      v_dialect_id,
      v_provisional_group
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

  -- Authoritative post-commit-within-transaction read: the same values the
  -- leaderboard function itself would compute right now for the groups this
  -- batch touched. The client shows exactly what the database holds, never
  -- an optimistic guess.
  select coalesce(jsonb_agg(jsonb_build_object(
    'main_group_code', grp.main_group_code,
    'submission_count', grp.submission_count
  )), '[]'::jsonb)
  into v_affected_groups
  from (
    select distinct coalesce(rws.admin_confirmed_main_group_code, d.main_group_code, rws.provisional_main_group_code) as touched_group
    from raw_word_submissions rws
    left join dialects d on d.id = rws.selected_dialect_id
    where rws.batch_id = v_batch_id
  ) touched
  join lateral (
    select
      touched.touched_group as main_group_code,
      (
        select count(*)
        from raw_word_submissions rws2
        left join dialects d2 on d2.id = rws2.selected_dialect_id
        where rws2.participation_exclusion_reason is null
          and coalesce(rws2.admin_confirmed_main_group_code, d2.main_group_code, rws2.provisional_main_group_code) = touched.touched_group
      ) as submission_count
  ) grp on true
  where touched.touched_group is not null;

  return query select v_batch_id, true, v_affected_groups;
end;
$$;

-- --- 3. Admin controls: participation exclusion + main-group override ----

create or replace function set_submission_participation_exclusion(
  p_actor uuid,
  p_submission_id uuid,
  p_reason text
)
returns raw_word_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_row raw_word_submissions%rowtype;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_reason is not null and p_reason not in ('spam', 'abuse', 'test', 'duplicate', 'invalid_submission') then
    raise exception 'invalid_exclusion_reason' using errcode = '22023';
  end if;

  select to_jsonb(raw_word_submissions.*) into v_before
  from raw_word_submissions where id = p_submission_id for update;
  if v_before is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update raw_word_submissions
  set participation_exclusion_reason = p_reason
  where id = p_submission_id
  returning * into v_row;

  insert into review_events (raw_submission_id, actor_id, action, before_state, after_state)
  values (
    p_submission_id, p_actor,
    case when p_reason is null then 'participation_exclusion_cleared' else 'participation_exclusion_set' end,
    v_before, to_jsonb(v_row)
  );

  return v_row;
end;
$$;

grant execute on function set_submission_participation_exclusion(uuid, uuid, text) to authenticated;

create or replace function set_submission_main_group(
  p_actor uuid,
  p_submission_id uuid,
  p_main_group_code text
)
returns raw_word_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_row raw_word_submissions%rowtype;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_main_group_code is not null and p_main_group_code not in ('hijazi', 'najdi', 'eastern', 'northern', 'southern') then
    raise exception 'invalid_main_group' using errcode = '22023';
  end if;

  select to_jsonb(raw_word_submissions.*) into v_before
  from raw_word_submissions where id = p_submission_id for update;
  if v_before is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update raw_word_submissions
  set admin_confirmed_main_group_code = p_main_group_code
  where id = p_submission_id
  returning * into v_row;

  insert into review_events (raw_submission_id, actor_id, action, before_state, after_state)
  values (p_submission_id, p_actor, 'main_group_reclassified', v_before, to_jsonb(v_row));

  return v_row;
end;
$$;

grant execute on function set_submission_main_group(uuid, uuid, text) to authenticated;

-- --- 4. Leaderboard: participation-ranked, both counts --------------------

drop function if exists public_dialect_leaderboard();

create or replace function public_dialect_leaderboard()
returns table (
  main_group_code text,
  main_group_label_ar text,
  submission_count bigint,
  approved_word_count bigint,
  rank integer
)
language sql
stable
security definer
set search_path = public
as $$
  with groups (code, label_ar, sort_order) as (
    values
      ('hijazi', 'حجازي', 1),
      ('najdi', 'نجدي', 2),
      ('eastern', 'شرقاوي', 3),
      ('northern', 'شمالي', 4),
      ('southern', 'جنوبي', 5)
  ),
  effective as (
    select
      coalesce(rws.admin_confirmed_main_group_code, d.main_group_code, rws.provisional_main_group_code) as main_group_code
    from raw_word_submissions rws
    left join dialects d on d.id = rws.selected_dialect_id
    where rws.participation_exclusion_reason is null
  ),
  sub_counts as (
    select main_group_code, count(*) as c
    from effective
    where main_group_code is not null
    group by main_group_code
  ),
  approved_counts as (
    select d.main_group_code, count(ce.id) as c
    from dialects d
    join canonical_entries ce on ce.canonical_dialect_id = d.id and ce.editorial_status = 'approved'
    group by d.main_group_code
  )
  select
    g.code,
    g.label_ar,
    coalesce(sc.c, 0) as submission_count,
    coalesce(ac.c, 0) as approved_word_count,
    (rank() over (order by coalesce(sc.c, 0) desc, g.sort_order asc))::integer as rank
  from groups g
  left join sub_counts sc on sc.main_group_code = g.code
  left join approved_counts ac on ac.main_group_code = g.code
  order by submission_count desc, g.sort_order asc;
$$;

grant execute on function public_dialect_leaderboard() to anon, authenticated;

-- --- 5. Admin visibility: unclassified/excluded counts --------------------

create or replace function admin_dashboard_counts(p_admin uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not is_active_admin(p_admin) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'new', count(*) filter (where review_status = 'new'),
    'pending', count(*) filter (where review_status = 'pending'),
    'approved', count(*) filter (where review_status = 'approved'),
    'rejected', count(*) filter (where review_status = 'rejected'),
    'duplicate', count(*) filter (where review_status = 'duplicate'),
    'merged', count(*) filter (where review_status = 'merged'),
    'total', count(*)
  ) into v_result
  from raw_word_submissions;

  v_result := v_result || jsonb_build_object(
    'unseen', (
      select count(*)
      from raw_word_submissions rws
      where not exists (
        select 1 from admin_submission_views v
        where v.raw_submission_id = rws.id and v.admin_id = p_admin
      )
    )
  );

  v_result := v_result || jsonb_build_object(
    'latest_export', (
      select to_jsonb(e) from exports e order by created_at desc limit 1
    )
  );

  v_result := v_result || jsonb_build_object(
    'unclassified_participation', (
      select count(*)
      from raw_word_submissions rws
      left join dialects d on d.id = rws.selected_dialect_id
      where rws.participation_exclusion_reason is null
        and coalesce(rws.admin_confirmed_main_group_code, d.main_group_code, rws.provisional_main_group_code) is null
    )
  );

  v_result := v_result || jsonb_build_object(
    'excluded_participation', (
      select count(*) from raw_word_submissions where participation_exclusion_reason is not null
    )
  );

  return v_result;
end;
$$;

grant execute on function admin_dashboard_counts(uuid) to authenticated;
