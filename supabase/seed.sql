-- Local-development-only seed. Applied automatically by `supabase db reset`
-- / `supabase start` — never by `supabase db push`, so this never reaches a
-- hosted project.
--
-- Mirrors the baseline table/sequence/function privileges every hosted
-- Supabase project already has from platform provisioning (granted once,
-- outside this repo's migrations). This repo's own migrations deliberately
-- never grant direct table access (see the documented convention in
-- 0016_optional_msa_synonym_and_public_dialects.sql) because Row Level
-- Security is the actual gate: with RLS enabled and no permissive policy,
-- a role with a full table grant still gets zero rows. Without this seed, a
-- fresh local Postgres created by the Supabase CLI has no base table grants
-- at all for anon/authenticated/service_role, which silently breaks admin
-- reads and the service-role-backed public submission path locally (while
-- working normally against a real hosted project) — see the 2026-08-26
-- Phase 1 verification notes for how this was diagnosed.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
