-- Fixes public_dialect_leaderboard() so tied groups actually get the same
-- rank number. The previous rank() window (0019) ordered by
-- (submission_count desc, g.sort_order asc) *inside* the window function —
-- since sort_order is unique per group (1..5), that compound key is never
-- equal for two rows, so rank() could never see a tie: five groups sitting
-- at zero submissions came back ranked 1,2,3,4,5 instead of all tying at 1.
-- That silently manufactured a false champion out of raw table order,
-- exactly what the competition-ranking UI must not do.
--
-- Fix: rank() only orders by submission_count (so genuine ties share a
-- rank, and 100/80/80/40/20 correctly yields 1/2/2/4/5). sort_order is kept
-- only as the final row ordering's tiebreak, for a deterministic display
-- order within a tie — it no longer leaks into the rank number itself.
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
    (rank() over (order by coalesce(sc.c, 0) desc))::integer as rank
  from groups g
  left join sub_counts sc on sc.main_group_code = g.code
  left join approved_counts ac on ac.main_group_code = g.code
  order by submission_count desc, g.sort_order asc;
$$;

grant execute on function public_dialect_leaderboard() to anon, authenticated;
