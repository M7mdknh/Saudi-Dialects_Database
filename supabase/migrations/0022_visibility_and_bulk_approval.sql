-- Separates review status (pending/approved/rejected) from public
-- visibility (public/private) on canonical entries, so an approved word can
-- be kept as useful reviewed/training data without appearing on any public
-- surface. Also fixes create_dialect() to inherit main_group_code from its
-- parent and to be idempotent on slug conflict, which the new fast
-- submitted-dialect bulk-approval flow (application-side orchestration over
-- create_dialect()/approve_raw_submission(), see review/bulk-approve.ts)
-- relies on.

-- --- 1. Visibility column -------------------------------------------------

alter table canonical_entries
  add column if not exists public_visibility text not null default 'public'
    check (public_visibility in ('public', 'private'));

create index if not exists canonical_entries_public_visibility_idx
  on canonical_entries (public_visibility);

-- --- 2. approve_raw_submission: accept an explicit visibility choice ------
-- Every existing caller (ReviewDetail's edit-then-approve, the old bulk
-- "اعتماد" flow) keeps working unchanged: p_visibility defaults to 'public',
-- matching the pre-existing behavior where every approved word was public.

drop function if exists approve_raw_submission(uuid, uuid, uuid, timestamptz, boolean, text, text, text[], text);

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

-- --- 3. Change visibility on an already-approved entry --------------------
-- Preserves canonical data, source links, and examples untouched; only
-- public_visibility changes. Optimistic concurrency on `version`, auditable
-- via review_events, undoable through the existing undo_review_event() path
-- (before_state carries the prior public_visibility).

create or replace function set_canonical_visibility(
  p_actor uuid,
  p_entry_id uuid,
  p_visibility text,
  p_expected_version integer
)
returns table (id uuid, public_visibility text, version integer, stale boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_current_version integer;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_visibility not in ('public', 'private') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;

  select canonical_entries.version, to_jsonb(canonical_entries.*) into v_current_version, v_before
  from canonical_entries where canonical_entries.id = p_entry_id
  for update;

  if v_current_version is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_expected_version is not null and v_current_version <> p_expected_version then
    return query select p_entry_id, (v_before ->> 'public_visibility')::text, v_current_version, true;
    return;
  end if;

  update canonical_entries
  set public_visibility = p_visibility, version = canonical_entries.version + 1
  where canonical_entries.id = p_entry_id
  returning canonical_entries.version into v_current_version;

  insert into review_events (canonical_entry_id, actor_id, action, before_state, after_state)
  values (
    p_entry_id, p_actor, 'visibility_change', v_before,
    jsonb_set(v_before, '{public_visibility}', to_jsonb(p_visibility))
  );

  return query select p_entry_id, p_visibility, v_current_version, false;
end;
$$;

grant execute on function set_canonical_visibility(uuid, uuid, text, integer) to authenticated;

-- --- 4. Public reads: only approved + public may ever surface -------------

drop function if exists public_dialect_words(text, text, text, text, integer, integer);

create or replace function public_dialect_words(
  p_main_group_code text default null,
  p_search text default null,
  p_category text default null,
  p_sort text default 'newest',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  canonical_word text,
  canonical_msa_synonyms text[],
  canonical_explanation text,
  local_dialect_label text,
  main_group_code text,
  main_group_label_ar text,
  category text,
  category_label_ar text,
  examples jsonb,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  return query
  with groups (code, label_ar) as (
    values
      ('hijazi', 'حجازي'), ('najdi', 'نجدي'), ('eastern', 'شرقاوي'),
      ('northern', 'شمالي'), ('southern', 'جنوبي')
  ),
  base as (
    select
      ce.id, ce.canonical_word, ce.canonical_msa_synonyms, ce.canonical_explanation,
      d.name_ar as local_dialect_label, d.main_group_code, g.label_ar as main_group_label_ar,
      rp.category, rp.category_label_ar, ce.updated_at, ce.canonical_word_search_key
    from canonical_entries ce
    join dialects d on d.id = ce.canonical_dialect_id
    left join groups g on g.code = d.main_group_code
    left join reference_prompts rp on rp.id = ce.reference_prompt_id
    where ce.editorial_status = 'approved'
      and ce.public_visibility = 'public'
      and (p_main_group_code is null or d.main_group_code = p_main_group_code)
      and (p_category is null or rp.category = p_category)
      and (
        p_search is null or btrim(p_search) = '' or
        ce.canonical_word ilike '%' || p_search || '%' or
        exists (select 1 from unnest(ce.canonical_msa_synonyms) s where s ilike '%' || p_search || '%')
      )
  )
  select
    b.id, b.canonical_word, b.canonical_msa_synonyms, b.canonical_explanation,
    b.local_dialect_label, b.main_group_code, b.main_group_label_ar,
    b.category, b.category_label_ar,
    coalesce(
      (select jsonb_agg(jsonb_build_object('sentence', ex.sentence) order by ex.position)
       from canonical_examples ex where ex.canonical_entry_id = b.id),
      '[]'::jsonb
    ) as examples,
    b.updated_at,
    count(*) over () as total_count
  from base b
  order by
    case when p_sort = 'alphabetical' then b.canonical_word_search_key end asc nulls last,
    case when p_sort <> 'alphabetical' then b.updated_at end desc nulls last,
    b.id asc
  limit v_limit offset v_offset;
end;
$$;

grant execute on function public_dialect_words(text, text, text, text, integer, integer) to anon, authenticated;

-- Approved-word leaderboard secondary count must mean approved *public*
-- words only — an approved-private word must never inflate it.

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
    join canonical_entries ce
      on ce.canonical_dialect_id = d.id
      and ce.editorial_status = 'approved'
      and ce.public_visibility = 'public'
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

-- --- 5. Fast bulk approval support: create_dialect ------------------------
-- create_dialect() previously left main_group_code null on every dialect it
-- created, so a newly-promoted local label never showed up correctly on the
-- public leaderboard/explorer/export until an admin separately reclassified
-- it. It now inherits main_group_code from its parent when one is given.
-- It is also now idempotent on a slug collision (returns/updates the
-- existing row instead of erroring) so the fast bulk-approval flow
-- (review/bulk-approve.ts) can safely retry without producing duplicate
-- taxonomy rows.

create or replace function create_dialect(p_actor uuid, p_name_ar text, p_slug text, p_parent_id uuid)
returns dialects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row dialects%rowtype;
  v_parent_group text;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_parent_id is not null then
    select main_group_code into v_parent_group from dialects where id = p_parent_id;
  end if;

  insert into dialects (name_ar, slug, parent_id, main_group_code)
  values (p_name_ar, p_slug, p_parent_id, v_parent_group)
  on conflict (slug) do update set
    name_ar = excluded.name_ar,
    parent_id = coalesce(dialects.parent_id, excluded.parent_id),
    main_group_code = coalesce(dialects.main_group_code, excluded.main_group_code),
    is_active = true
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function create_dialect(uuid, text, text, uuid) to authenticated;
