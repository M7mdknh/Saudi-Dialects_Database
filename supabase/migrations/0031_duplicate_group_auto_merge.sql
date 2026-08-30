-- Automatic merging for clear exact-word duplicates, to reduce manual
-- review time. Mirrors the pure decision logic in
-- src/features/duplicates/auto-merge-rules.ts exactly — keep both in sync.
--
-- Core restriction: automatic merging only ever applies within one
-- word_key (candidate_type = 'exact'). It never uses fuzzy spelling or
-- semantic similarity, and it never merges different word forms — "جب" and
-- "جيب" always stay separate canonical entries (see 0030) and may only
-- ever share a concept_id.

-- --- 1. Meaning normalization -----------------------------------------------

create or replace function normalize_meaning_text(p_text text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(trim(p_text), '\s+', ' ', 'g'), '')
$$;

create or replace function distinct_normalized_meanings(p_meanings text[])
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct m), '{}')
  from unnest(coalesce(p_meanings, '{}')) t(raw_text)
  cross join lateral (select normalize_meaning_text(t.raw_text) as m) n
  where m is not null
$$;

-- --- 2. Extend the shared candidate-member and group queries with -----------
--        concept_id (canonical only) and an auto_mergeable classification ---

drop function if exists duplicate_candidate_members();

create or replace function duplicate_candidate_members()
returns table (
  member_type text,
  member_id uuid,
  word text,
  word_search_key text,
  main_group_code text,
  local_dialect_label text,
  meaning text,
  example_count integer,
  status text,
  canonical_entry_id uuid,
  public_visibility text,
  created_at timestamptz,
  concept_id text
)
language sql
stable
as $$
  select 'raw'::text, r.id, r.submitted_word, r.word_search_key,
         d.main_group_code, case when d.parent_id is not null then d.name_ar else null end,
         r.submitted_explanation,
         (select count(*)::int from raw_examples re where re.raw_submission_id = r.id),
         r.review_status, null::uuid, null::text, r.created_at, null::text
  from raw_word_submissions r
  left join dialects d on d.id = r.selected_dialect_id
  where r.review_status in ('new', 'pending', 'approved', 'merged')
  union all
  select 'canonical'::text, c.id, c.canonical_word, c.canonical_word_search_key,
         d.main_group_code, case when d.parent_id is not null then d.name_ar else null end,
         c.canonical_explanation,
         (select count(*)::int from canonical_examples ce where ce.canonical_entry_id = c.id),
         c.editorial_status, c.id, c.public_visibility, c.created_at, c.concept_id
  from canonical_entries c
  left join dialects d on d.id = c.canonical_dialect_id
  where c.editorial_status = 'approved'
$$;

grant execute on function duplicate_candidate_members() to authenticated;

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
  p_offset integer default 0
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
      -- Strict, non-fuzzy classification: any 2+ distinct normalized
      -- meanings (exact text match only, never a shared-word heuristic) or
      -- 2+ distinct non-null concept_id values route the group to manual
      -- review as "تعارض في المعنى" instead of being classified 'exact'.
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
    select distinct word_search_key from members
  ),
  -- Deliberately does NOT exclude a key just because it already has its own
  -- exact group: word A can be exactly duplicated among some records *and*
  -- separately be a fuzzy spelling-variant suggestion against a distinct
  -- word B at the same time — e.g. three exact "اتمرمط" submissions plus a
  -- fourth "اترمرط" typo of the same word are both real, independent
  -- signals an admin should see, not one masking the other. A fuzzy pair
  -- is, by construction (a.word_search_key < b.word_search_key), always
  -- two distinct keys, so it can never literally duplicate a single-key
  -- exact group.
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
      -- A fuzzy (different word_key) group is never auto-mergeable — these
      -- placeholder counts only exist to satisfy the union's column shape.
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
      end as resolved_status
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
    -- Never fuzzy/conflict, never an already-admin-resolved group, never
    -- more than one existing canonical entry, never a meaning or concept
    -- conflict.
    (
      wr.candidate_type = 'exact'
      and wr.resolved_status = 'unresolved'
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

grant execute on function duplicate_group_candidates(text, text, text, text, integer, text, text, integer, integer) to authenticated;

-- --- 3. Count of currently auto-mergeable groups, for the admin batch -------
--        action's "eligible groups" preview. Read-only.

create or replace function count_auto_mergeable_duplicate_groups()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not is_active_admin(auth.uid()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select count(*) into v_count
  from duplicate_group_candidates(null, 'exact', null, null, null, 'unresolved', 'newest', 2147483647, 0) g
  where g.auto_mergeable;

  return v_count;
end;
$$;

grant execute on function count_auto_mergeable_duplicate_groups() to authenticated;

-- --- 4. Automatic merge of one exact group -----------------------------------
--
-- Idempotent: a raw submission already linked to a canonical entry via
-- entry_sources is never reprocessed, and a group with nothing new to fold
-- in (no unlinked raw sources, an existing target entry) is a true no-op —
-- no version bump, no duplicate examples/dialects/source links, no new
-- review event. Never destructive: canonical_entry_dialects only ever
-- gains rows here, and an existing canonical entry's editorial_status /
-- public_visibility are left exactly as they were (never silently
-- published or auto-approved).

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
  from duplicate_group_candidates(null, null, null, null, null, null, 'newest', 2147483647, 0) dgc
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

  -- Meaning: only zero or one distinct normalized meaning can reach this
  -- point (auto_mergeable already guarantees it) — resolve the exact value
  -- to write from the target's existing meaning (if any) plus every new
  -- raw source's own explanation, preferring to keep an already-settled
  -- meaning untouched.
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

  -- Dialects: union of the target's existing set with every new raw
  -- source's own selected dialect. Never removes an existing assignment.
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

  -- canonical_dialect_id sync: preserve the existing primary; otherwise the
  -- dialect with the most new sources, tie-broken by the stable main-group
  -- order then dialect id.
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

  -- MSA synonyms: union, deduplicated.
  select canonical_msa_synonyms into v_existing_synonyms from canonical_entries where id = v_target_entry_id;
  select array_agg(distinct submitted_msa_synonym) into v_new_synonyms
  from raw_word_submissions
  where id = any(coalesce(v_new_raw_ids, '{}'))
    and submitted_msa_synonym is not null and length(trim(submitted_msa_synonym)) > 0;
  select array_agg(distinct s) into v_final_synonyms
  from unnest(coalesce(v_existing_synonyms, '{}') || coalesce(v_new_synonyms, '{}')) s;

  if v_target_entry_id is null then
    -- Nothing to snapshot — the entry doesn't exist yet.
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

    -- Never silently publish a private/unapproved record: editorial_status
    -- and public_visibility are deliberately left untouched here.
    update canonical_entries set
      canonical_dialect_id = v_primary_dialect,
      canonical_msa_synonyms = coalesce(v_final_synonyms, '{}'),
      canonical_explanation = v_final_meaning,
      version = canonical_entries.version + 1,
      updated_at = now()
    where canonical_entries.id = v_target_entry_id;
  end if;

  -- Dialects: additive only, never delete.
  foreach v_dialect_id in array v_all_dialect_ids loop
    insert into canonical_entry_dialects (canonical_entry_id, dialect_id)
    values (v_target_entry_id, v_dialect_id)
    on conflict do nothing;
  end loop;

  -- Sources and provenance.
  v_is_first := (v_before is null);
  foreach v_raw_id in array coalesce(v_new_raw_ids, '{}') loop
    insert into entry_sources (canonical_entry_id, raw_submission_id, relation, linked_by)
    values (v_target_entry_id, v_raw_id, case when v_is_first then 'primary' else 'merged' end, p_actor)
    on conflict (canonical_entry_id, raw_submission_id) do nothing;

    update raw_word_submissions set review_status = 'merged' where id = v_raw_id;
    v_is_first := false;
  end loop;

  -- Examples: union every distinct valid example; exact duplicates (after
  -- trimming) are the only ones removed, via the existing unique
  -- constraint on (canonical_entry_id, sentence_search_key).
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

  -- Logged as 'edit_full' so an update to an existing entry is undoable
  -- through undo_canonical_entry_edit() (0028), same as manual duplicate
  -- merges (0029). A brand-new entry has no before_state to restore to,
  -- matching that same existing limitation for manual merges.
  insert into review_events (canonical_entry_id, actor_id, action, before_state, after_state)
  values (v_target_entry_id, p_actor, 'edit_full', v_before, v_after);

  select md5(array_to_string(dgc.member_ids, ','))
    into v_fresh_signature
  from duplicate_group_candidates(null, null, null, null, null, null, 'newest', 2147483647, 0) dgc
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

-- --- 5. Bulk batch action for the existing backlog --------------------------
--
-- "دمج الحالات الواضحة تلقائيًا": processes every currently unresolved exact
-- group that passes the automatic-merge rule. Groups with a meaning or
-- concept conflict (or any other ineligibility) are left untouched in the
-- manual queue. Each group is processed in its own sub-transaction
-- (savepoint) so one failure never rolls back groups already merged.

create or replace function bulk_auto_merge_duplicate_groups(p_actor uuid)
returns table (group_key text, entry_id uuid, merged boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_group_key text;
  v_result record;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  for v_group_key in
    select g.group_key
    from duplicate_group_candidates(null, 'exact', null, null, null, 'unresolved', 'newest', 2147483647, 0) g
    where g.auto_mergeable
  loop
    begin
      select * into v_result from auto_merge_duplicate_group(p_actor, v_group_key);
      group_key := v_group_key;
      entry_id := v_result.entry_id;
      merged := v_result.merged;
      reason := v_result.reason;
      return next;
    exception when others then
      group_key := v_group_key;
      entry_id := null;
      merged := false;
      reason := 'error';
      return next;
    end;
  end loop;
end;
$$;

grant execute on function bulk_auto_merge_duplicate_groups(uuid) to authenticated;

-- --- 6. Backend duplicate-processing hook for newly-approved submissions ----
--
-- Whenever an admin approves a raw submission (single or bulk), opportunis-
-- tically fold in any other still-pending exact-word_key duplicates that
-- are now cleanly auto-mergeable — e.g. sibling submissions of the same
-- word in a different dialect. Best-effort and non-blocking: never lets an
-- automatic-merge side effect fail the approval itself. Existing backlog
-- groups (already sitting unresolved before this feature) are untouched by
-- this hook — they are handled by the explicit batch action above.

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

  -- Backend duplicate-processing workflow for newly-formed duplicate
  -- groups: best-effort only, never allowed to fail this approval.
  begin
    perform auto_merge_duplicate_group(p_actor, 'exact:' || v_word_key);
  exception when others then
    null;
  end;

  return query select v_entry_id, 'approved'::text, v_current, false, p_visibility;
end;
$$;

grant execute on function approve_raw_submission(uuid, uuid, uuid, timestamptz, boolean, text, text, text[], text, text) to authenticated;

notify pgrst, 'reload schema';
