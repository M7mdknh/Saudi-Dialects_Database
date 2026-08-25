-- Public-safe read functions. Anon/authenticated get no direct table grants
-- on reference_prompts, canonical_entries, canonical_examples, or dialects
-- (consistent with the existing "no direct reads" convention for
-- non-admin roles); every public read goes through one of these
-- SECURITY DEFINER functions, each returning only explicitly safe columns.

-- Guided-prompt bank for the public contribution page. The server action
-- that calls this fetches the full active set (small: ~300 rows) once on
-- the server and runs selection/rotation logic in application code — the
-- full set is never sent to the browser, only the 6 chosen prompts are.
create or replace function list_active_reference_prompts()
returns table (
  id text,
  category text,
  category_label_ar text,
  msa_lemma text,
  definition_ar text,
  scenario_ar text,
  part_of_speech text,
  answer_form text,
  priority integer,
  prompt_version integer
)
language sql
stable
security definer
set search_path = public
as $$
  select id, category, category_label_ar, msa_lemma, definition_ar, scenario_ar,
    part_of_speech, answer_form, priority, prompt_version
  from reference_prompts
  where is_active = true;
$$;

grant execute on function list_active_reference_prompts() to anon, authenticated;

-- Ranks the five fixed Saudi main groups by approved, unique canonical word
-- count only. Never derived from raw submissions; merges/reclassifications
-- are reflected immediately because this reads canonical_entries live.
create or replace function public_dialect_leaderboard()
returns table (main_group_code text, main_group_label_ar text, approved_word_count bigint)
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
  )
  select
    g.code,
    g.label_ar,
    coalesce(count(ce.id) filter (where ce.editorial_status = 'approved'), 0) as approved_word_count
  from groups g
  left join dialects d on d.main_group_code = g.code
  left join canonical_entries ce on ce.canonical_dialect_id = d.id
  group by g.code, g.label_ar, g.sort_order
  order by approved_word_count desc, g.sort_order asc;
$$;

grant execute on function public_dialect_leaderboard() to anon, authenticated;

-- Approved-only explorer listing for one main group (or all, when null),
-- with search/category filter/sort/pagination. Returns only safe public
-- fields plus a window-function total_count for pagination.
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
