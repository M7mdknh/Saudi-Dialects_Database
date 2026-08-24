-- Dashboard aggregate: status counts, unseen count for the calling admin,
-- and latest export metadata. Kept as one round trip for the admin
-- dashboard instead of several client-side count queries.
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

  return v_result;
end;
$$;

grant execute on function admin_dashboard_counts(uuid) to authenticated;

-- Possible-duplicate candidates for a raw submission: other raw submissions
-- (not itself, not already merged/rejected) sharing the same word search key,
-- ranked with same-dialect matches first. Recommendation only — see
-- data-model.md; never auto-merges or auto-approves.
create or replace function duplicate_candidates(p_submission_id uuid)
returns table (
  id uuid,
  submitted_word text,
  submitted_dialect text,
  review_status text,
  created_at timestamptz,
  same_dialect boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select other.id, other.submitted_word, other.submitted_dialect, other.review_status,
    other.created_at, other.dialect_search_key = self.dialect_search_key as same_dialect
  from raw_word_submissions self
  join raw_word_submissions other
    on other.word_search_key = self.word_search_key
    and other.id <> self.id
  where self.id = p_submission_id
  order by same_dialect desc, other.created_at asc;
$$;

grant execute on function duplicate_candidates(uuid) to authenticated;
