-- Ordered, paginated guided-prompt browsing for the homepage's predictable
-- batch-of-6 progression and the new /prompts page. Replaces the previous
-- random-rotation selection (selection.ts) with a stable server-side order,
-- so the API can paginate instead of shipping the full ~300-row pool to the
-- browser for client-side sorting.
--
-- reference_prompts has no natural display order (id is an opaque slug,
-- insertion order isn't guaranteed by Postgres). display_order is
-- introduced deterministically from the existing priority/id columns —
-- stable prompt IDs are untouched.

alter table reference_prompts
  add column if not exists display_order integer;

with ordered as (
  select id, row_number() over (order by priority desc, id asc) as rn
  from reference_prompts
)
update reference_prompts rp
set display_order = ordered.rn
from ordered
where ordered.id = rp.id and rp.display_order is null;

alter table reference_prompts
  alter column display_order set not null;

create unique index if not exists reference_prompts_display_order_idx
  on reference_prompts (display_order);

-- Paginated, ordered, filterable public read — the /prompts page and the
-- homepage's batch-of-6 progression both call this. Only explicitly safe
-- columns are returned, same convention as list_active_reference_prompts().
create or replace function list_reference_prompts_page(
  p_offset integer default 0,
  p_limit integer default 6,
  p_category text default null,
  p_search text default null
)
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
  prompt_version integer,
  display_order integer,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 60);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  return query
  select
    rp.id, rp.category, rp.category_label_ar, rp.msa_lemma, rp.definition_ar,
    rp.scenario_ar, rp.part_of_speech, rp.answer_form, rp.priority,
    rp.prompt_version, rp.display_order,
    count(*) over () as total_count
  from reference_prompts rp
  where rp.is_active = true
    and (p_category is null or rp.category = p_category)
    and (
      p_search is null or btrim(p_search) = '' or
      rp.msa_lemma ilike '%' || p_search || '%' or
      rp.definition_ar ilike '%' || p_search || '%'
    )
  order by rp.display_order asc
  limit v_limit offset v_offset;
end;
$$;

grant execute on function list_reference_prompts_page(integer, integer, text, text) to anon, authenticated;

-- Category counts for the /prompts sidebar/filter — a small (<=~30 row),
-- public-safe aggregate, never the full prompt set.
create or replace function list_reference_prompt_category_counts()
returns table (category text, category_label_ar text, prompt_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select category, min(category_label_ar), count(*)
  from reference_prompts
  where is_active = true
  group by category
  order by min(category_label_ar);
$$;

grant execute on function list_reference_prompt_category_counts() to anon, authenticated;
