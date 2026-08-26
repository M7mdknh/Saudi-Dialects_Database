-- Full canonical dictionary editor: multi-dialect linkage for canonical
-- entries (a word can genuinely belong to more than one main Saudi group
-- and/or more than one local dialect, not just the single
-- canonical_dialect_id every earlier migration assumed), a transactional
-- full-entry update function, and a paginated/filterable list query for
-- the Excel-like admin table. Additive and backward-compatible:
-- canonical_dialect_id is untouched and still the "primary" dialect every
-- existing query (v1/v2/v3 export, merge, approve) already reads.

-- --- 1. Multi-dialect junction ---------------------------------------------

create table if not exists canonical_entry_dialects (
  canonical_entry_id uuid not null references canonical_entries(id) on delete cascade,
  dialect_id uuid not null references dialects(id),
  primary key (canonical_entry_id, dialect_id)
);

alter table canonical_entry_dialects enable row level security;

create policy admin_read_canonical_entry_dialects on canonical_entry_dialects
  for select to authenticated using (is_active_admin(auth.uid()));

-- Backfill: every existing canonical entry keeps exactly the dialect it
-- already had, now also represented in the junction table. No existing
-- word's classification changes.
insert into canonical_entry_dialects (canonical_entry_id, dialect_id)
select id, canonical_dialect_id from canonical_entries
on conflict do nothing;

-- --- 2. Full-entry update (word, meaning, synonyms, multi-dialect, ---------
--        examples, related words, concept, register, visibility) ----------

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

  select to_jsonb(canonical_entries.*), canonical_entries.version
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
    p_entry_id, p_actor, 'edit', v_before,
    to_jsonb((select ce from canonical_entries ce where ce.id = p_entry_id))
  );

  return query select p_entry_id, v_current_version + 1, false;
end;
$$;

grant execute on function update_canonical_entry_full(
  uuid, uuid, integer, text, text, text, text[], uuid[], jsonb, text[], text, text, text
) to authenticated;

-- undo_review_event() (0003) only restored word/dialect/explanation/status
-- from before_state — widen it to also restore the fields this editor can
-- change (msa_synonyms, visibility, related_words, concept_id, register),
-- since before_state already snapshots the full row via to_jsonb(). Still
-- does not restore the dialect *set* (canonical_entry_dialects) or the
-- example list — those are relational, not scalar columns on the row
-- being snapshotted; undoing them is out of scope for this pass.
create or replace function undo_review_event(p_actor uuid, p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event review_events%rowtype;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_event from review_events where id = p_event_id;
  if v_event.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_event.before_state is null then
    raise exception 'nothing_to_undo' using errcode = '22023';
  end if;

  if v_event.raw_submission_id is not null then
    update raw_word_submissions
    set review_status = v_event.before_state ->> 'review_status'
    where id = v_event.raw_submission_id;
  end if;

  if v_event.canonical_entry_id is not null and v_event.action in ('edit', 'merge') then
    update canonical_entries set
      canonical_word = coalesce(v_event.before_state ->> 'canonical_word', canonical_word),
      canonical_dialect_id = coalesce((v_event.before_state ->> 'canonical_dialect_id')::uuid, canonical_dialect_id),
      canonical_explanation = v_event.before_state ->> 'canonical_explanation',
      editorial_status = coalesce(v_event.before_state ->> 'editorial_status', editorial_status),
      canonical_msa_synonyms = coalesce(
        (select array_agg(x) from jsonb_array_elements_text(v_event.before_state -> 'canonical_msa_synonyms') x),
        canonical_msa_synonyms
      ),
      public_visibility = coalesce(v_event.before_state ->> 'public_visibility', public_visibility),
      related_words = coalesce(
        (select array_agg(x) from jsonb_array_elements_text(v_event.before_state -> 'related_words') x),
        related_words
      ),
      concept_id = v_event.before_state ->> 'concept_id',
      register = v_event.before_state ->> 'register',
      version = version + 1
    where id = v_event.canonical_entry_id;
  end if;

  insert into review_events (raw_submission_id, canonical_entry_id, actor_id, action, before_state, after_state)
  values (v_event.raw_submission_id, v_event.canonical_entry_id, p_actor, 'undo', to_jsonb(v_event), v_event.before_state);
end;
$$;

-- --- 3. Excel-like list query: search, filters, sort, pagination ----------

create or replace function dictionary_entries_list(
  p_search text default null,
  p_main_group_code text default null,
  p_local_dialect_label text default null,
  p_visibility text default null,
  p_register text default null,
  p_missing_meaning boolean default null,
  p_missing_examples boolean default null,
  p_missing_concept boolean default null,
  p_sort text default 'updated_desc',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  canonical_word text,
  canonical_word_search_key text,
  concept_id text,
  canonical_explanation text,
  canonical_msa_synonyms text[],
  register text,
  public_visibility text,
  main_group_codes text[],
  local_dialect_labels text[],
  example_count integer,
  related_words text[],
  updated_at timestamptz,
  version integer,
  total_count bigint
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
  -- Always includes the entry's own canonical_dialect_id unioned with the
  -- junction table, not the junction alone: approve_raw_submission() and
  -- merge_submissions()/merge_duplicate_group() set canonical_dialect_id
  -- but don't populate canonical_entry_dialects, so an entry never edited
  -- through this new editor would otherwise show no dialect at all here.
  with entry_dialect_ids as (
    select c.id as canonical_entry_id, c.canonical_dialect_id as dialect_id
    from canonical_entries c
    union
    select ced.canonical_entry_id, ced.dialect_id
    from canonical_entry_dialects ced
  ),
  entry_dialects as (
    select
      eid.canonical_entry_id,
      array_agg(distinct d.main_group_code) filter (where d.main_group_code is not null) as main_group_codes,
      array_agg(distinct d.name_ar) filter (where d.parent_id is not null) as local_dialect_labels
    from entry_dialect_ids eid
    join dialects d on d.id = eid.dialect_id
    group by eid.canonical_entry_id
  ),
  entry_examples as (
    select
      canonical_examples.canonical_entry_id,
      count(*)::integer as example_count,
      array_agg(canonical_examples.sentence) as sentences
    from canonical_examples
    group by canonical_examples.canonical_entry_id
  ),
  base as (
    select
      c.id, c.canonical_word, c.canonical_word_search_key, c.concept_id,
      c.canonical_explanation, c.canonical_msa_synonyms, c.register,
      c.public_visibility, c.related_words, c.updated_at, c.version,
      coalesce(ed.main_group_codes, array[]::text[]) as main_group_codes,
      coalesce(ed.local_dialect_labels, array[]::text[]) as local_dialect_labels,
      coalesce(ee.example_count, 0) as example_count,
      ee.sentences
    from canonical_entries c
    left join entry_dialects ed on ed.canonical_entry_id = c.id
    left join entry_examples ee on ee.canonical_entry_id = c.id
    where c.editorial_status = 'approved'
  )
  select
    b.id, b.canonical_word, b.canonical_word_search_key, b.concept_id,
    b.canonical_explanation, b.canonical_msa_synonyms, b.register,
    b.public_visibility, b.main_group_codes, b.local_dialect_labels,
    b.example_count, b.related_words, b.updated_at, b.version,
    count(*) over ()::bigint as total_count
  from base b
  where
    (p_search is null or
      b.canonical_word ilike '%' || p_search || '%' or
      b.canonical_word_search_key ilike '%' || p_search || '%' or
      b.canonical_explanation ilike '%' || p_search || '%' or
      b.concept_id ilike '%' || p_search || '%' or
      exists (select 1 from unnest(b.sentences) s where s ilike '%' || p_search || '%') or
      exists (select 1 from unnest(b.local_dialect_labels) l where l ilike '%' || p_search || '%'))
    and (p_main_group_code is null or p_main_group_code = any(b.main_group_codes))
    and (p_local_dialect_label is null or p_local_dialect_label = any(b.local_dialect_labels))
    and (p_visibility is null or b.public_visibility = p_visibility)
    and (p_register is null or b.register = p_register)
    and (p_missing_meaning is null or p_missing_meaning = (b.canonical_explanation is null or length(trim(b.canonical_explanation)) = 0))
    and (p_missing_examples is null or p_missing_examples = (b.example_count = 0))
    and (p_missing_concept is null or p_missing_concept = (b.concept_id is null or length(trim(b.concept_id)) = 0))
  order by
    case when p_sort = 'word_asc' then b.canonical_word_search_key end asc nulls last,
    case when p_sort = 'word_desc' then b.canonical_word_search_key end desc nulls last,
    case when p_sort = 'updated_asc' then b.updated_at end asc nulls last,
    case when p_sort = 'updated_desc' or p_sort is null then b.updated_at end desc nulls last,
    b.id
  limit p_limit offset p_offset;
end;
$$;

grant execute on function dictionary_entries_list(
  text, text, text, text, text, boolean, boolean, boolean, text, integer, integer
) to authenticated;

-- --- 4. Single-entry detail (all editable fields, plus current dialects) --

create or replace function dictionary_entry_detail(p_entry_id uuid)
returns table (
  id uuid,
  canonical_word text,
  canonical_word_search_key text,
  concept_id text,
  canonical_explanation text,
  canonical_msa_synonyms text[],
  register text,
  public_visibility text,
  related_words text[],
  version integer,
  dialect_ids uuid[],
  examples jsonb
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
  select
    c.id, c.canonical_word, c.canonical_word_search_key, c.concept_id,
    c.canonical_explanation, c.canonical_msa_synonyms, c.register,
    c.public_visibility, c.related_words, c.version,
    (select array_agg(distinct dialect_id) from (
      select c.canonical_dialect_id as dialect_id
      union
      select ced.dialect_id from canonical_entry_dialects ced where ced.canonical_entry_id = c.id
    ) all_ids),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', ce.id, 'sentence', ce.sentence, 'position', ce.position) order by ce.position)
      from canonical_examples ce where ce.canonical_entry_id = c.id
    ), '[]'::jsonb)
  from canonical_entries c
  where c.id = p_entry_id and c.editorial_status = 'approved';
end;
$$;

grant execute on function dictionary_entry_detail(uuid) to authenticated;

-- --- 5. Bulk actions: visibility and single-main-dialect reclassification --

create or replace function bulk_set_dictionary_visibility(
  p_actor uuid,
  p_entry_ids uuid[],
  p_visibility text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_visibility not in ('public', 'private') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;

  update canonical_entries
  set public_visibility = p_visibility, version = version + 1
  where id = any(p_entry_ids) and editorial_status = 'approved';
  get diagnostics v_count = row_count;

  insert into review_events (canonical_entry_id, actor_id, action, before_state, after_state)
  select id, p_actor, 'bulk_visibility_' || p_visibility, null, jsonb_build_object('entry_id', id)
  from canonical_entries where id = any(p_entry_ids);

  return v_count;
end;
$$;

grant execute on function bulk_set_dictionary_visibility(uuid, uuid[], text) to authenticated;

create or replace function bulk_add_dictionary_dialect(
  p_actor uuid,
  p_entry_ids uuid[],
  p_dialect_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  insert into canonical_entry_dialects (canonical_entry_id, dialect_id)
  select e, p_dialect_id from unnest(p_entry_ids) as e
  on conflict do nothing;
  get diagnostics v_count = row_count;

  insert into review_events (canonical_entry_id, actor_id, action, before_state, after_state)
  select id, p_actor, 'bulk_add_dialect', null, jsonb_build_object('entry_id', id, 'dialect_id', p_dialect_id)
  from canonical_entries where id = any(p_entry_ids);

  return v_count;
end;
$$;

grant execute on function bulk_add_dictionary_dialect(uuid, uuid[], uuid) to authenticated;
