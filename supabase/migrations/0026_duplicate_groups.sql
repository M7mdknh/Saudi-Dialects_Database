-- Duplicate-management center: server-side duplicate-group detection,
-- persistent resolution state, and a multi-source merge function that
-- extends merge_submissions() with the v4 dictionary fields.
--
-- Everything a group is computed from (raw_word_submissions,
-- canonical_entries) is queried inside SECURITY DEFINER functions — the
-- browser never downloads the raw dataset to compute groups itself.

-- pg_trgm's trigram similarity is unreliable for short Arabic dialect words
-- (most are 3-7 letters, too few trigrams to score well even for a 1-letter
-- typo); a normalized edit-distance ratio from fuzzystrmatch's levenshtein()
-- is a more conservative, more legible "similar spelling" signal instead.
create extension if not exists fuzzystrmatch;

-- Normalized [0,1] spelling-similarity score: 1 minus edit distance
-- relative to the longer word's length. Never used for anything but a
-- suggestion (see duplicate_group_candidates below) — never for identity.
create or replace function spelling_similarity(a text, b text)
returns numeric
language sql
immutable
as $$
  select case
    when greatest(length(a), length(b)) = 0 then 0
    else 1.0 - (levenshtein(a, b)::numeric / greatest(length(a), length(b)))
  end
$$;

-- --- 1. Persistent resolution state --------------------------------------
--
-- A group's identity is its `group_key` (deterministic from its members'
-- word_search_key(s) — see the functions below). `member_signature` is a
-- hash of the sorted member ids the group had when last resolved; if a
-- fresh computation's signature no longer matches, the group is treated as
-- unresolved again automatically (a new matching submission arrived) even
-- though this row still remembers the previous decision.

create table if not exists duplicate_group_resolutions (
  group_key text primary key,
  status text not null default 'unresolved'
    check (status in ('unresolved', 'not_duplicate', 'ignored', 'merged')),
  member_signature text,
  canonical_entry_id uuid references canonical_entries(id),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table duplicate_group_resolutions enable row level security;

create policy admin_read_duplicate_group_resolutions on duplicate_group_resolutions
  for select to authenticated using (is_active_admin(auth.uid()));

-- --- 2. Meaning-conflict heuristic ----------------------------------------
--
-- Suggestion-only: flags an exact-word_key group as a possible sense
-- conflict when it has 2+ distinct non-blank meanings that share no
-- significant (3+ letter) word. Never used to auto-merge or auto-split —
-- only to route the group into "تعارض في المعنى" for a human to review.

create or replace function meanings_conflict(p_meanings text[])
returns boolean
language plpgsql
immutable
as $$
declare
  v_distinct text[];
  v_words_i text[];
  v_words_j text[];
  v_shared boolean;
  i int;
  j int;
begin
  select array_agg(distinct m) into v_distinct
  from unnest(p_meanings) as m
  where m is not null and length(trim(m)) > 0;

  if v_distinct is null or array_length(v_distinct, 1) < 2 then
    return false;
  end if;

  for i in 1 .. array_length(v_distinct, 1) loop
    for j in (i + 1) .. array_length(v_distinct, 1) loop
      v_words_i := (select array_agg(w) from unnest(regexp_split_to_array(v_distinct[i], '\s+')) w where length(w) >= 3);
      v_words_j := (select array_agg(w) from unnest(regexp_split_to_array(v_distinct[j], '\s+')) w where length(w) >= 3);
      select exists (
        select 1 from unnest(coalesce(v_words_i, '{}')) a
        join unnest(coalesce(v_words_j, '{}')) b on a = b
      ) into v_shared;
      if not v_shared then
        return true;
      end if;
    end loop;
  end loop;

  return false;
end;
$$;

-- --- 3. Candidate members (shared by every query below) ------------------

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
  created_at timestamptz
)
language sql
stable
as $$
  select 'raw'::text, r.id, r.submitted_word, r.word_search_key,
         d.main_group_code, case when d.parent_id is not null then d.name_ar else null end,
         r.submitted_explanation,
         (select count(*)::int from raw_examples re where re.raw_submission_id = r.id),
         r.review_status, null::uuid, null::text, r.created_at
  from raw_word_submissions r
  left join dialects d on d.id = r.selected_dialect_id
  where r.review_status in ('new', 'pending', 'approved', 'merged')
  union all
  select 'canonical'::text, c.id, c.canonical_word, c.canonical_word_search_key,
         d.main_group_code, case when d.parent_id is not null then d.name_ar else null end,
         c.canonical_explanation,
         (select count(*)::int from canonical_examples ce where ce.canonical_entry_id = c.id),
         c.editorial_status, c.id, c.public_visibility, c.created_at
  from canonical_entries c
  left join dialects d on d.id = c.canonical_dialect_id
  where c.editorial_status = 'approved'
$$;

grant execute on function duplicate_candidate_members() to authenticated;

-- --- 4. Group listing: filterable, sortable, paginated --------------------

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
  member_ids uuid[]
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
      array_agg(member_id order by member_id) as member_ids
    from members
    group by word_search_key
    having count(*) >= 2
  ),
  exact_groups as (
    select
      'exact:' || word_search_key as group_key,
      case when meanings_conflict(meanings) then 'conflict' else 'exact' end as candidate_type,
      word, word_search_key, candidate_count, main_group_codes, local_labels, meanings,
      example_count, has_canonical, canonical_entry_id, canonical_status, public_visibility,
      newest_candidate_at, 1.0::numeric as match_strength, member_ids
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
      array_agg(m.member_id order by m.member_id) as member_ids
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
    wr.member_ids
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

-- --- 5. Summary counts (global, independent of the current page/filters) --

create or replace function duplicate_group_summary()
returns table (
  unresolved_groups integer,
  exact_match_groups integer,
  possible_match_groups integer,
  total_source_records integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    count(*) filter (where resolution_status = 'unresolved')::integer,
    count(*) filter (where candidate_type in ('exact', 'conflict'))::integer,
    count(*) filter (where candidate_type = 'fuzzy')::integer,
    coalesce(sum(candidate_count) filter (where resolution_status = 'unresolved'), 0)::integer
  from duplicate_group_candidates(null, null, null, null, null, null, 'newest', 2147483647, 0);
end;
$$;

grant execute on function duplicate_group_summary() to authenticated;

-- --- 6. Group detail: full members + examples, for the merge workspace ----

create or replace function duplicate_group_members(p_group_key text)
returns table (
  member_type text,
  member_id uuid,
  word text,
  main_group_code text,
  local_dialect_label text,
  meaning text,
  msa_synonym text,
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
  select 'raw'::text, r.id, r.submitted_word, d.main_group_code,
         case when d.parent_id is not null then d.name_ar else null end,
         r.submitted_explanation, r.submitted_msa_synonym,
         coalesce((select jsonb_agg(jsonb_build_object('id', re.id, 'sentence', re.sentence) order by re.position) from raw_examples re where re.raw_submission_id = r.id), '[]'::jsonb),
         null::text[], null::text, null::text, null::text, r.reference_prompt_id, null::integer
  from raw_word_submissions r
  left join dialects d on d.id = r.selected_dialect_id
  where r.id in (select member_id from target_ids)
    and r.review_status in ('new', 'pending', 'approved', 'merged')
  union all
  select 'canonical'::text, c.id, c.canonical_word, d.main_group_code,
         case when d.parent_id is not null then d.name_ar else null end,
         c.canonical_explanation, null::text,
         coalesce((select jsonb_agg(jsonb_build_object('id', ce.id, 'sentence', ce.sentence) order by ce.position) from canonical_examples ce where ce.canonical_entry_id = c.id), '[]'::jsonb),
         c.related_words, c.concept_id, c.register, c.public_visibility, c.reference_prompt_id, c.version
  from canonical_entries c
  left join dialects d on d.id = c.canonical_dialect_id
  where c.id in (select member_id from target_ids);
end;
$$;

grant execute on function duplicate_group_members(text) to authenticated;

-- --- 7. Resolve / reopen a group -------------------------------------------

create or replace function resolve_duplicate_group(
  p_actor uuid,
  p_group_key text,
  p_status text,
  p_member_signature text
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
  if p_status not in ('not_duplicate', 'ignored') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  insert into duplicate_group_resolutions (group_key, status, member_signature, resolved_by, resolved_at)
  values (p_group_key, p_status, p_member_signature, p_actor, now())
  on conflict (group_key) do update set
    status = excluded.status,
    member_signature = excluded.member_signature,
    resolved_by = excluded.resolved_by,
    resolved_at = excluded.resolved_at,
    updated_at = now();

  insert into review_events (actor_id, action, before_state, after_state)
  values (p_actor, 'duplicate_group_' || p_status, null, jsonb_build_object('group_key', p_group_key));
end;
$$;

grant execute on function resolve_duplicate_group(uuid, text, text, text) to authenticated;

create or replace function reopen_duplicate_group(p_actor uuid, p_group_key text)
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
  set status = 'unresolved', updated_at = now()
  where group_key = p_group_key;

  insert into review_events (actor_id, action, before_state, after_state)
  values (p_actor, 'duplicate_group_reopen', null, jsonb_build_object('group_key', p_group_key));
end;
$$;

grant execute on function reopen_duplicate_group(uuid, text) to authenticated;

-- --- 8. Multi-source merge, extending merge_submissions() ------------------
--
-- Superset of merge_submissions(): also accepts the v4 fields (concept_id,
-- register, related_words), an explicit visibility choice, canonical
-- example ids to remove (from a previous merge into the same target being
-- re-edited), and optimistic-concurrency + double-merge protection via
-- p_expected_version and a row lock on the group's resolution row (which
-- also marks the group 'merged', so a concurrent second submit for the
-- same group_key serializes behind the first and then observes it's
-- already resolved).

create or replace function merge_duplicate_group(
  p_actor uuid,
  p_group_key text,
  p_member_signature text,
  p_raw_submission_ids uuid[],
  p_target_entry_id uuid,
  p_expected_version integer,
  p_canonical_word text,
  p_canonical_word_search_key text,
  p_canonical_dialect_id uuid,
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
declare
  v_entry_id uuid;
  v_current_version integer;
  v_before jsonb;
  v_raw_id uuid;
  v_removed_id uuid;
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

  if p_target_entry_id is null then
    insert into canonical_entries (
      canonical_word, canonical_word_search_key, canonical_dialect_id,
      canonical_msa_synonyms, canonical_explanation, editorial_status,
      approved_by, approved_at, reference_prompt_id,
      related_words, concept_id, register, public_visibility
    ) values (
      p_canonical_word, p_canonical_word_search_key, p_canonical_dialect_id,
      p_canonical_msa_synonyms, nullif(p_canonical_explanation, ''), 'approved', p_actor, now(),
      p_reference_prompt_id, coalesce(p_related_words, '{}'), p_concept_id, p_register,
      coalesce(p_visibility, 'public')
    )
    returning id into v_entry_id;
  else
    v_entry_id := p_target_entry_id;
    select to_jsonb(canonical_entries.*), version into v_before, v_current_version
      from canonical_entries where id = v_entry_id for update;

    if v_current_version is null then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    if p_expected_version is not null and v_current_version <> p_expected_version then
      raise exception 'stale_version' using errcode = '40001';
    end if;

    update canonical_entries set
      canonical_word = p_canonical_word,
      canonical_word_search_key = p_canonical_word_search_key,
      canonical_dialect_id = p_canonical_dialect_id,
      canonical_msa_synonyms = p_canonical_msa_synonyms,
      canonical_explanation = nullif(p_canonical_explanation, ''),
      editorial_status = 'approved',
      version = version + 1,
      approved_by = p_actor,
      approved_at = now(),
      reference_prompt_id = coalesce(canonical_entries.reference_prompt_id, p_reference_prompt_id),
      related_words = coalesce(p_related_words, canonical_entries.related_words),
      concept_id = coalesce(p_concept_id, canonical_entries.concept_id),
      register = coalesce(p_register, canonical_entries.register),
      public_visibility = coalesce(p_visibility, canonical_entries.public_visibility)
    where id = v_entry_id;
  end if;

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
  -- computed (p_member_signature identifies what was *selected to merge*,
  -- for the concurrency/idempotency guard above; it is never what gets
  -- stored as "resolved membership"). Recompute it fresh so the group
  -- correctly reads as resolved on the very next fetch instead of
  -- immediately auto-reopening against its own new membership.
  select md5(array_to_string(dgc.member_ids, ','))
    into v_fresh_signature
  from duplicate_group_candidates(null, null, null, null, null, null, 'newest', 2147483647, 0) dgc
  where dgc.group_key = p_group_key;

  update duplicate_group_resolutions
  set status = 'merged', member_signature = coalesce(v_fresh_signature, p_member_signature),
      canonical_entry_id = v_entry_id,
      resolved_by = p_actor, resolved_at = now(), updated_at = now()
  where group_key = p_group_key;

  insert into review_events (canonical_entry_id, actor_id, action, before_state, after_state)
  values (
    v_entry_id, p_actor, 'duplicate_group_merge', v_before,
    jsonb_build_object('canonical_entry_id', v_entry_id, 'source_ids', p_raw_submission_ids, 'group_key', p_group_key)
  );

  return v_entry_id;
end;
$$;

grant execute on function merge_duplicate_group(
  uuid, text, text, uuid[], uuid, integer, text, text, uuid, text[], text, jsonb, uuid[], text[], text, text, text, text
) to authenticated;
