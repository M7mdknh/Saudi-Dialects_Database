-- Row-level security. Every exposed table is covered.
--
-- Public/anon: no direct table access at all. The public submission path
-- goes through the service-role-backed submit_batch() function called from
-- the validated server route, never through direct table grants.
-- Authenticated-but-not-admin: no access either.
-- Active admins: read access to review data; writes go through the
-- SECURITY DEFINER functions in 0003_functions.sql, not direct table grants,
-- so admin table grants below are read-only.

alter table submission_batches enable row level security;
alter table raw_word_submissions enable row level security;
alter table raw_examples enable row level security;
alter table dialects enable row level security;
alter table dialect_aliases enable row level security;
alter table canonical_entries enable row level security;
alter table canonical_examples enable row level security;
alter table entry_sources enable row level security;
alter table review_events enable row level security;
alter table admin_submission_views enable row level security;
alter table admins enable row level security;
alter table exports enable row level security;

-- No policies are created for anon/authenticated on the raw/editorial
-- tables: with RLS enabled and no permissive policy, all direct access is
-- denied by default for every role except the service-role key (which
-- bypasses RLS) used server-side.

create policy admin_read_submission_batches on submission_batches
  for select to authenticated using (is_active_admin(auth.uid()));

create policy admin_read_raw_word_submissions on raw_word_submissions
  for select to authenticated using (is_active_admin(auth.uid()));

create policy admin_read_raw_examples on raw_examples
  for select to authenticated using (is_active_admin(auth.uid()));

-- Canonical dialect taxonomy and aliases are admin-managed reference data;
-- read access is restricted to admins in V1 (no public dictionary browsing).
create policy admin_read_dialects on dialects
  for select to authenticated using (is_active_admin(auth.uid()));

create policy admin_read_dialect_aliases on dialect_aliases
  for select to authenticated using (is_active_admin(auth.uid()));

create policy admin_read_canonical_entries on canonical_entries
  for select to authenticated using (is_active_admin(auth.uid()));

create policy admin_read_canonical_examples on canonical_examples
  for select to authenticated using (is_active_admin(auth.uid()));

create policy admin_read_entry_sources on entry_sources
  for select to authenticated using (is_active_admin(auth.uid()));

create policy admin_read_review_events on review_events
  for select to authenticated using (is_active_admin(auth.uid()));

create policy admin_read_admin_submission_views on admin_submission_views
  for select to authenticated using (is_active_admin(auth.uid()));

-- mark_submission_seen() runs SECURITY DEFINER, so it does not need a
-- direct insert policy; no direct insert policy is granted here.

-- Admins may see the allowlist only to confirm their own membership, never
-- to enumerate or alter other admins (allowlist changes are an operator
-- task performed with the service-role key / SQL, not the app).
create policy admin_read_self on admins
  for select to authenticated using (user_id = auth.uid());

create policy admin_read_exports on exports
  for select to authenticated using (is_active_admin(auth.uid()));
