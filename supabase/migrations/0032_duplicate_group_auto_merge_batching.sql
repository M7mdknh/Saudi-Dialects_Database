-- Fixes a confirmed production failure: bulk_auto_merge_duplicate_groups()
-- (0031) processed every eligible group inside ONE PostgREST request, which
-- is ONE Postgres transaction — the per-group `begin ... exception when
-- others` blocks are savepoints, not independent commits, so nothing became
-- durable until the whole call returned. Against a real backlog (791
-- eligible groups reported in production), that single request exceeded the
-- platform's timeout layers (PostgREST/connection-pool statement timeout,
-- the serverless function's execution limit) well before 791 groups could
-- be processed serially, and the browser only ever saw a generic failure —
-- with the entire transaction rolled back and rendering the corrective
-- action a full unbounded no-op instead of the incremental cleanup it was
-- meant to be.
--
-- Replaces the single unbounded RPC with a claim-and-process design:
--   1. claim_auto_mergeable_duplicate_groups() atomically claims up to
--      p_limit eligible groups using `for update skip locked`, so two
--      concurrent callers (two tabs, two admins) can never claim the same
--      group. This call is itself fast and bounded (a plain indexed
--      select + update), and commits immediately on return.
--   2. The caller then invokes the existing, already-atomic and
--      already-idempotent auto_merge_duplicate_group() ONCE PER CLAIMED
--      GROUP, as separate round-trips/transactions — so each group's
--      result is durable the moment that individual call returns,
--      regardless of what happens to any other group in the batch or to
--      the client afterward (refresh, network drop, timeout).
--   3. A claim is a short lease (claimed_at + claim_lease_seconds), so a
--      crashed/interrupted client's claimed-but-never-processed groups
--      become reclaimable again automatically — never stuck forever.
--   4. A group that keeps throwing unexpected errors accumulates
--      failure_count and is excluded from future automatic claims once it
--      hits a small ceiling, instead of being retried forever — it stays
--      'unresolved' and fully visible/actionable in the manual queue.
--
-- bulk_auto_merge_duplicate_groups() (0031) is removed — it must never be
-- reachable again.

drop function if exists bulk_auto_merge_duplicate_groups(uuid);

alter table duplicate_group_resolutions
  add column if not exists claimed_by uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists failure_count integer not null default 0,
  add column if not exists last_failure_reason text;

comment on column duplicate_group_resolutions.claimed_by is
  'Admin currently processing this group via the automatic-merge batch flow. Short lease (see claim_auto_mergeable_duplicate_groups) — never a durable lock.';
comment on column duplicate_group_resolutions.failure_count is
  'Consecutive unexpected errors while attempting automatic merge. A group at or above the ceiling in claim_auto_mergeable_duplicate_groups is excluded from future automatic claims and stays in the manual review queue.';

create index if not exists duplicate_group_resolutions_auto_merge_claim_idx
  on duplicate_group_resolutions (group_key)
  where status = 'unresolved';

-- --- 1. Claim up to p_limit eligible groups, concurrency-safe ---------------

create or replace function claim_auto_mergeable_duplicate_groups(
  p_actor uuid,
  p_limit integer default 25,
  p_lease_seconds integer default 90,
  p_max_failures integer default 3
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_keys text[];
  v_claimed_keys text[];
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;

  -- Stable ordering (group_key) so repeated calls make steady forward
  -- progress through the backlog rather than reshuffling on every request.
  select array_agg(g.group_key order by g.group_key) into v_candidate_keys
  from duplicate_group_candidates(null, 'exact', null, null, null, 'unresolved', 'newest', 2147483647, 0) g
  where g.auto_mergeable;

  if coalesce(array_length(v_candidate_keys, 1), 0) = 0 then
    return '{}';
  end if;

  -- Every candidate group needs a resolution row to claim/lock — create any
  -- missing ones up front (idempotent, never overwrites an existing row).
  insert into duplicate_group_resolutions (group_key, status)
  select k, 'unresolved' from unnest(v_candidate_keys) as k
  on conflict (group_key) do nothing;

  select array_agg(group_key order by group_key) into v_claimed_keys
  from (
    select group_key
    from duplicate_group_resolutions
    where group_key = any(v_candidate_keys)
      and status = 'unresolved'
      and failure_count < p_max_failures
      and (claimed_at is null or claimed_at < now() - make_interval(secs => p_lease_seconds))
    order by group_key
    limit p_limit
    for update skip locked
  ) claimable;

  if coalesce(array_length(v_claimed_keys, 1), 0) = 0 then
    return '{}';
  end if;

  update duplicate_group_resolutions
  set claimed_by = p_actor, claimed_at = now()
  where group_key = any(v_claimed_keys);

  return v_claimed_keys;
end;
$$;

grant execute on function claim_auto_mergeable_duplicate_groups(uuid, integer, integer, integer) to authenticated;

-- --- 2. Release a claim after processing (success, ineligible, or error) ----
--
-- Called once per group right after auto_merge_duplicate_group() returns
-- (from the application layer), so the group becomes immediately visible
-- for the next claim instead of waiting out the full lease. Never touches
-- `status` itself — auto_merge_duplicate_group() already owns that.

create or replace function release_duplicate_group_claim(
  p_actor uuid,
  p_group_key text,
  p_failed boolean default false,
  p_failure_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update duplicate_group_resolutions
  set claimed_by = null,
      claimed_at = null,
      failure_count = case when p_failed then failure_count + 1 else 0 end,
      last_failure_reason = case when p_failed then p_failure_reason else null end,
      updated_at = now()
  where group_key = p_group_key;
end;
$$;

grant execute on function release_duplicate_group_claim(uuid, text, boolean, text) to authenticated;

-- --- 3. Second, compounding root cause: quadratic fuzzy-pair computation ---
--
-- duplicate_group_candidates() always computed the O(n^2) fuzzy-spelling
-- cross join (every distinct word_search_key against every other) even
-- when the caller only wanted exact-word groups (p_candidate_type =
-- 'exact') — the fuzzy CTEs are unconditional, so the WHERE clause could
-- only filter the *output*, long after paying the full quadratic cost.
-- auto_merge_duplicate_group() calls this function twice per group (once
-- to validate, once to recompute a fresh signature), and the old
-- unbounded bulk RPC (0031) called it once per group on top of that — so
-- with several hundred distinct words already in the system, every single
-- automatic-merge attempt was silently re-paying a full system-wide
-- fuzzy-similarity scan, compounding the timeout risk from the unbounded
-- transaction above. Verified locally: ~800 distinct words alone produced
-- well over 100,000 fuzzy candidate rows from one call.
--
-- Fix: `distinct_keys` (the fuzzy computation's only input) is now empty
-- whenever the caller has already restricted the result to exact groups,
-- which collapses the cross join to a no-op — and every auto-merge-path
-- caller (claim, count, and both internal lookups inside
-- auto_merge_duplicate_group) now explicitly requests 'exact' so none of
-- them ever pay the fuzzy cost. The general admin listing (which does need
-- fuzzy results) is unaffected — its behavior and output are unchanged.

-- Adding a parameter changes the function's identity (name + input types),
-- so CREATE OR REPLACE alone would create a second, ambiguous overload
-- instead of replacing this one — drop the old 9-argument signature first.
drop function if exists duplicate_group_candidates(text, text, text, text, integer, text, text, integer, integer);

create or replace function duplicate_group_candidates(
  p_search text default null,
  p_candidate_type text default null,
  p_main_group_code text default null,
  p_local_dialect_label text default null,
  p_min_candidates integer default null,
  p_resolution_status text default null,
  p_sort text default 'newest',
  p_limit integer default 20,
  p_offset integer default 0,
  -- Explicit opt-out of the O(n^2) fuzzy-spelling computation, independent
  -- of p_candidate_type: a 'conflict' row is a *reclassified exact* group
  -- (see exact_groups below) and never comes from the fuzzy branch, so a
  -- caller that wants exact+conflict but never fuzzy (every auto-merge
  -- code path) cannot express that through p_candidate_type alone. Always
  -- defaults to false so every pre-existing caller's behavior/output is
  -- byte-for-byte unchanged.
  p_skip_fuzzy boolean default false
)
returns table (
  group_key text,
  candidate_type text,
  word text,
  word_search_key text,
  candidate_count integer,
  main_group_codes text[],
  local_dialect_labels text[],
  meanings text[],
  example_count integer,
  has_canonical boolean,
  canonical_entry_id uuid,
  canonical_status text,
  public_visibility text,
  resolution_status text,
  newest_candidate_at timestamptz,
  match_strength numeric,
  total_count bigint,
  member_ids uuid[],
  auto_mergeable boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  with members as (
    select * from duplicate_candidate_members()
  ),
  exact_raw as (
    select
      word_search_key,
      array_agg(distinct main_group_code) filter (where main_group_code is not null) as main_group_codes,
      array_agg(distinct local_dialect_label) filter (where local_dialect_label is not null) as local_labels,
      array_agg(distinct meaning) filter (where meaning is not null and length(trim(meaning)) > 0) as meanings,
      coalesce(sum(example_count), 0)::integer as example_count,
      count(*)::integer as candidate_count,
      bool_or(member_type = 'canonical') as has_canonical,
      (array_agg(canonical_entry_id) filter (where canonical_entry_id is not null))[1] as canonical_entry_id,
      (array_agg(public_visibility order by created_at desc) filter (where public_visibility is not null))[1] as public_visibility,
      (array_agg(status order by (member_type = 'canonical') desc, created_at desc))[1] as canonical_status,
      max(created_at) as newest_candidate_at,
      (array_agg(word order by member_type = 'canonical' desc, created_at asc))[1] as word,
      array_agg(member_id order by member_id) as member_ids,
      count(*) filter (where member_type = 'canonical')::integer as canonical_count,
      array_length(distinct_normalized_meanings(array_agg(meaning)), 1) as distinct_meaning_count,
      (select count(distinct c) from unnest(array_agg(concept_id) filter (where concept_id is not null)) c)::integer as distinct_concept_count
    from members
    group by word_search_key
    having count(*) >= 2
  ),
  exact_groups as (
    select
      'exact:' || word_search_key as group_key,
      case
        when coalesce(distinct_meaning_count, 0) >= 2 then 'conflict'
        when coalesce(distinct_concept_count, 0) >= 2 then 'conflict'
        else 'exact'
      end as candidate_type,
      word, word_search_key, candidate_count, main_group_codes, local_labels, meanings,
      example_count, has_canonical, canonical_entry_id, canonical_status, public_visibility,
      newest_candidate_at, 1.0::numeric as match_strength, member_ids,
      canonical_count, coalesce(distinct_meaning_count, 0) as distinct_meaning_count,
      coalesce(distinct_concept_count, 0) as distinct_concept_count
    from exact_raw
  ),
  distinct_keys as (
    -- Empty (not just filtered later) whenever the caller has already
    -- restricted to exact groups — this is what actually collapses the
    -- O(n^2) cross join below to a no-op, since joining against zero rows
    -- is trivial regardless of how many distinct words exist system-wide.
    select distinct word_search_key from members
    -- Only the fuzzy branch ever needs this — 'conflict' rows come from
    -- exact_groups (a reclassified exact match), never from fuzzy_groups.
    where not p_skip_fuzzy and (p_candidate_type is null or p_candidate_type = 'fuzzy')
  ),
  fuzzy_pairs as (
    select
      a.word_search_key as key_a,
      b.word_search_key as key_b,
      spelling_similarity(a.word_search_key, b.word_search_key) as sim
    from distinct_keys a
    join distinct_keys b on a.word_search_key < b.word_search_key
    where spelling_similarity(a.word_search_key, b.word_search_key) >= 0.55
  ),
  fuzzy_groups as (
    select
      'fuzzy:' || fp.key_a || ':' || fp.key_b as group_key,
      'fuzzy'::text as candidate_type,
      (array_agg(m.word order by m.member_type = 'canonical' desc, m.created_at asc))[1] as word,
      fp.key_a as word_search_key,
      count(m.member_id)::integer as candidate_count,
      array_agg(distinct m.main_group_code) filter (where m.main_group_code is not null) as main_group_codes,
      array_agg(distinct m.local_dialect_label) filter (where m.local_dialect_label is not null) as local_labels,
      array_agg(distinct m.meaning) filter (where m.meaning is not null and length(trim(m.meaning)) > 0) as meanings,
      coalesce(sum(m.example_count), 0)::integer as example_count,
      bool_or(m.member_type = 'canonical') as has_canonical,
      (array_agg(m.canonical_entry_id) filter (where m.canonical_entry_id is not null))[1] as canonical_entry_id,
      (array_agg(m.status order by (m.member_type = 'canonical') desc, m.created_at desc))[1] as canonical_status,
      (array_agg(m.public_visibility order by m.created_at desc) filter (where m.public_visibility is not null))[1] as public_visibility,
      max(m.created_at) as newest_candidate_at,
      fp.sim::numeric as match_strength,
      array_agg(m.member_id order by m.member_id) as member_ids,
      0 as canonical_count, 0 as distinct_meaning_count, 0 as distinct_concept_count
    from fuzzy_pairs fp
    join members m on m.word_search_key in (fp.key_a, fp.key_b)
    group by fp.key_a, fp.key_b, fp.sim
  ),
  all_groups as (
    select * from exact_groups
    union all
    select * from fuzzy_groups
  ),
  with_signature as (
    select
      ag.*,
      md5(array_to_string(ag.member_ids, ',')) as computed_signature
    from all_groups ag
  ),
  with_resolution as (
    select
      ws.*,
      case
        when r.status is null then 'unresolved'
        when r.member_signature is distinct from ws.computed_signature then 'unresolved'
        else r.status
      end as resolved_status,
      -- The raw persisted decision, independent of the "does the current
      -- membership still match what was last resolved" self-healing above.
      -- An admin's explicit not_duplicate/ignored/merged/split call is a
      -- standing decision that new members joining the group must never
      -- silently reopen for *automatic* processing — claim_auto_mergeable_
      -- duplicate_groups() and auto_merge_duplicate_group() both gate on
      -- this same raw value, so auto_mergeable here must match exactly or
      -- the preview count would promise merges the claim step will refuse.
      coalesce(r.status, 'unresolved') as raw_status
    from with_signature ws
    left join duplicate_group_resolutions r on r.group_key = ws.group_key
  )
  select
    wr.group_key, wr.candidate_type, wr.word, wr.word_search_key, wr.candidate_count,
    wr.main_group_codes, wr.local_labels, wr.meanings, wr.example_count, wr.has_canonical,
    wr.canonical_entry_id, wr.canonical_status, wr.public_visibility, wr.resolved_status,
    wr.newest_candidate_at, wr.match_strength,
    count(*) over ()::bigint as total_count,
    wr.member_ids,
    (
      wr.candidate_type = 'exact'
      and wr.resolved_status = 'unresolved'
      and wr.raw_status = 'unresolved'
      and wr.canonical_count <= 1
      and wr.distinct_meaning_count <= 1
      and wr.distinct_concept_count <= 1
    ) as auto_mergeable
  from with_resolution wr
  where (p_search is null or wr.word ilike '%' || p_search || '%' or wr.word_search_key ilike '%' || p_search || '%')
    and (p_candidate_type is null or wr.candidate_type = p_candidate_type)
    and (p_main_group_code is null or p_main_group_code = any(wr.main_group_codes))
    and (p_local_dialect_label is null or p_local_dialect_label = any(wr.local_labels))
    and (p_min_candidates is null or wr.candidate_count >= p_min_candidates)
    and (p_resolution_status is null or wr.resolved_status = p_resolution_status)
  order by
    case when p_sort = 'largest' then wr.candidate_count end desc nulls last,
    case when p_sort = 'strongest' then wr.match_strength end desc nulls last,
    case when p_sort = 'newest' or p_sort is null then wr.newest_candidate_at end desc nulls last,
    wr.group_key
  limit p_limit offset p_offset;
end;
$$;

grant execute on function duplicate_group_candidates(text, text, text, text, integer, text, text, integer, integer, boolean) to authenticated;

-- --- 4. auto_merge_duplicate_group(): use the exact-only fast path ----------
--
-- Identical logic to 0031, except both internal duplicate_group_candidates
-- lookups now pass p_candidate_type = 'exact' explicitly — a group being
-- auto-merged is always exact by construction (auto_mergeable requires
-- candidate_type = 'exact'), so this changes no behavior, only cost.

create or replace function auto_merge_duplicate_group(
  p_actor uuid,
  p_group_key text
)
returns table (entry_id uuid, merged boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_lock_status text;
  v_group record;
  v_raw_ids uuid[];
  v_canonical_ids uuid[];
  v_target_entry_id uuid;
  v_new_raw_ids uuid[];
  v_current_version integer;
  v_before jsonb;
  v_after jsonb;
  v_meaning_sources text[];
  v_distinct_meanings text[];
  v_final_meaning text;
  v_existing_dialect_ids uuid[];
  v_new_dialect_ids uuid[];
  v_all_dialect_ids uuid[];
  v_existing_primary uuid;
  v_primary_dialect uuid;
  v_dialect_id uuid;
  v_existing_synonyms text[];
  v_new_synonyms text[];
  v_final_synonyms text[];
  v_raw_id uuid;
  v_is_first boolean;
  v_fresh_signature text;
  v_max_position integer;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  insert into duplicate_group_resolutions (group_key, status)
  values (p_group_key, 'unresolved')
  on conflict (group_key) do nothing;

  select status into v_lock_status from duplicate_group_resolutions where group_key = p_group_key for update;

  if v_lock_status = 'merged' then
    select canonical_entry_id into v_target_entry_id from duplicate_group_resolutions where group_key = p_group_key;
    return query select v_target_entry_id, false, 'already_resolved'::text;
    return;
  end if;
  if v_lock_status in ('split', 'not_duplicate', 'ignored') then
    return query select null::uuid, false, 'already_resolved'::text;
    return;
  end if;

  select * into v_group
  from duplicate_group_candidates(null, null, null, null, null, null, 'newest', 2147483647, 0, true) dgc
  where dgc.group_key = p_group_key;

  if not found then
    return query select null::uuid, false, 'not_found'::text;
    return;
  end if;
  if v_group.candidate_type <> 'exact' then
    return query select null::uuid, false, 'not_exact'::text;
    return;
  end if;
  if not v_group.auto_mergeable then
    return query select null::uuid, false, 'conflict'::text;
    return;
  end if;

  select array_agg(id) into v_raw_ids from raw_word_submissions where id = any(v_group.member_ids);
  select array_agg(id) into v_canonical_ids from canonical_entries where id = any(v_group.member_ids);

  if coalesce(array_length(v_canonical_ids, 1), 0) > 1 then
    return query select null::uuid, false, 'multiple_canonical_entries'::text;
    return;
  end if;

  v_target_entry_id := case when v_canonical_ids is not null then v_canonical_ids[1] else null end;

  select array_agg(r.id) into v_new_raw_ids
  from raw_word_submissions r
  where r.id = any(coalesce(v_raw_ids, '{}'))
    and not exists (select 1 from entry_sources es where es.raw_submission_id = r.id);

  if v_target_entry_id is not null and coalesce(array_length(v_new_raw_ids, 1), 0) = 0 then
    return query select v_target_entry_id, true, 'already_up_to_date'::text;
    return;
  end if;
  if v_target_entry_id is null and coalesce(array_length(v_new_raw_ids, 1), 0) < 2 then
    return query select null::uuid, false, 'insufficient_sources'::text;
    return;
  end if;

  select canonical_explanation into v_final_meaning from canonical_entries where id = v_target_entry_id;

  if normalize_meaning_text(v_final_meaning) is null then
    select array_agg(submitted_explanation order by created_at, id) into v_meaning_sources
    from raw_word_submissions where id = any(coalesce(v_new_raw_ids, '{}'));

    v_distinct_meanings := distinct_normalized_meanings(coalesce(v_meaning_sources, '{}'));
    if array_length(v_distinct_meanings, 1) = 1 then
      select trim(submitted_explanation) into v_final_meaning
      from raw_word_submissions
      where id = any(coalesce(v_new_raw_ids, '{}'))
        and normalize_meaning_text(submitted_explanation) = v_distinct_meanings[1]
      order by created_at, id
      limit 1;
    end if;
  end if;

  if v_target_entry_id is not null then
    select array_agg(distinct dialect_id) into v_existing_dialect_ids
    from (
      select canonical_dialect_id as dialect_id from canonical_entries where id = v_target_entry_id
      union
      select dialect_id from canonical_entry_dialects where canonical_entry_id = v_target_entry_id
    ) x
    where dialect_id is not null;
    select canonical_dialect_id into v_existing_primary from canonical_entries where id = v_target_entry_id;
  end if;

  select array_agg(distinct selected_dialect_id) into v_new_dialect_ids
  from raw_word_submissions
  where id = any(coalesce(v_new_raw_ids, '{}')) and selected_dialect_id is not null;

  select array_agg(distinct d) into v_all_dialect_ids
  from unnest(coalesce(v_existing_dialect_ids, '{}') || coalesce(v_new_dialect_ids, '{}')) d;

  if coalesce(array_length(v_all_dialect_ids, 1), 0) = 0 then
    return query select null::uuid, false, 'dialect_required'::text;
    return;
  end if;

  if v_existing_primary is not null then
    v_primary_dialect := v_existing_primary;
  else
    select r.selected_dialect_id into v_primary_dialect
    from raw_word_submissions r
    join dialects d on d.id = r.selected_dialect_id
    where r.id = any(coalesce(v_new_raw_ids, '{}')) and r.selected_dialect_id is not null
    group by r.selected_dialect_id
    order by
      count(*) desc,
      min(case d.main_group_code
            when 'hijazi' then 1 when 'najdi' then 2 when 'eastern' then 3
            when 'northern' then 4 when 'southern' then 5 else 6 end) asc,
      r.selected_dialect_id::text asc
    limit 1;
  end if;

  select canonical_msa_synonyms into v_existing_synonyms from canonical_entries where id = v_target_entry_id;
  select array_agg(distinct submitted_msa_synonym) into v_new_synonyms
  from raw_word_submissions
  where id = any(coalesce(v_new_raw_ids, '{}'))
    and submitted_msa_synonym is not null and length(trim(submitted_msa_synonym)) > 0;
  select array_agg(distinct s) into v_final_synonyms
  from unnest(coalesce(v_existing_synonyms, '{}') || coalesce(v_new_synonyms, '{}')) s;

  if v_target_entry_id is null then
    v_before := null;

    insert into canonical_entries (
      canonical_word, canonical_word_search_key, canonical_dialect_id,
      canonical_msa_synonyms, canonical_explanation, editorial_status,
      approved_by, approved_at, public_visibility
    ) values (
      v_group.word, v_group.word_search_key, v_primary_dialect,
      coalesce(v_final_synonyms, '{}'), v_final_meaning, 'approved',
      p_actor, now(), 'public'
    )
    returning id into v_target_entry_id;
  else
    select
      jsonb_build_object(
        'entry', to_jsonb(canonical_entries.*),
        'dialect_ids', coalesce(
          (select jsonb_agg(ced.dialect_id) from canonical_entry_dialects ced where ced.canonical_entry_id = v_target_entry_id),
          '[]'::jsonb
        ),
        'examples', coalesce(
          (select jsonb_agg(jsonb_build_object(
              'id', ce.id, 'sentence', ce.sentence, 'sentence_search_key', ce.sentence_search_key,
              'source_raw_example_id', ce.source_raw_example_id, 'position', ce.position
            ) order by ce.position)
           from canonical_examples ce where ce.canonical_entry_id = v_target_entry_id),
          '[]'::jsonb
        )
      ),
      canonical_entries.version
    into v_before, v_current_version
    from canonical_entries where canonical_entries.id = v_target_entry_id for update;

    update canonical_entries set
      canonical_dialect_id = v_primary_dialect,
      canonical_msa_synonyms = coalesce(v_final_synonyms, '{}'),
      canonical_explanation = v_final_meaning,
      version = canonical_entries.version + 1,
      updated_at = now()
    where canonical_entries.id = v_target_entry_id;
  end if;

  foreach v_dialect_id in array v_all_dialect_ids loop
    insert into canonical_entry_dialects (canonical_entry_id, dialect_id)
    values (v_target_entry_id, v_dialect_id)
    on conflict do nothing;
  end loop;

  v_is_first := (v_before is null);
  foreach v_raw_id in array coalesce(v_new_raw_ids, '{}') loop
    insert into entry_sources (canonical_entry_id, raw_submission_id, relation, linked_by)
    values (v_target_entry_id, v_raw_id, case when v_is_first then 'primary' else 'merged' end, p_actor)
    on conflict (canonical_entry_id, raw_submission_id) do nothing;

    update raw_word_submissions set review_status = 'merged' where id = v_raw_id;
    v_is_first := false;
  end loop;

  select coalesce(max(position), -1) into v_max_position
  from canonical_examples where canonical_entry_id = v_target_entry_id;

  insert into canonical_examples (canonical_entry_id, sentence, sentence_search_key, source_raw_example_id, position)
  select
    v_target_entry_id,
    trim(re.sentence),
    re.sentence_search_key,
    re.id,
    v_max_position + row_number() over (order by re.raw_submission_id, re.position)
  from raw_examples re
  where re.raw_submission_id = any(coalesce(v_new_raw_ids, '{}'))
    and length(trim(re.sentence)) > 0
  on conflict (canonical_entry_id, sentence_search_key) do nothing;

  select jsonb_build_object(
    'entry', to_jsonb(c.*),
    'dialect_ids', coalesce((select jsonb_agg(ced.dialect_id) from canonical_entry_dialects ced where ced.canonical_entry_id = v_target_entry_id), '[]'::jsonb),
    'examples', coalesce(
      (select jsonb_agg(jsonb_build_object(
          'id', ce.id, 'sentence', ce.sentence, 'sentence_search_key', ce.sentence_search_key,
          'source_raw_example_id', ce.source_raw_example_id, 'position', ce.position
        ) order by ce.position)
       from canonical_examples ce where ce.canonical_entry_id = v_target_entry_id),
      '[]'::jsonb
    ),
    'auto_merge', true,
    'group_key', p_group_key
  ) into v_after
  from canonical_entries c where c.id = v_target_entry_id;

  insert into review_events (canonical_entry_id, actor_id, action, before_state, after_state)
  values (v_target_entry_id, p_actor, 'edit_full', v_before, v_after);

  select md5(array_to_string(dgc.member_ids, ','))
    into v_fresh_signature
  from duplicate_group_candidates(null, null, null, null, null, null, 'newest', 2147483647, 0, true) dgc
  where dgc.group_key = p_group_key;

  update duplicate_group_resolutions
  set status = 'merged', member_signature = v_fresh_signature,
      canonical_entry_id = v_target_entry_id,
      resolved_by = p_actor, resolved_at = now(), updated_at = now()
  where group_key = p_group_key;

  return query select v_target_entry_id, true, 'merged'::text;
end;
$$;

grant execute on function auto_merge_duplicate_group(uuid, text) to authenticated;
