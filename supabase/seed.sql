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

-- Automatic-merge Playwright fixtures. Deterministic and reproducible on a
-- fresh `supabase db reset`, unlike the earlier ad-hoc duplicate-scenario
-- rows (زعلان، طنشني، فزع، اتمرمط، اترمرط) referenced by the older duplicate
-- -center specs, which were never captured in a tracked seed and only exist
-- in whatever local Postgres volume they were manually inserted into.
--
-- Sixty clean two-source exact groups (دفعة_تلقائي_1..60) for the batching/
-- progress UI to actually process across multiple 25-group batches, plus
-- one meaning-conflict pair (دفعة_تعارض_1) that must stay in manual review.
do $$
declare
  v_najdi uuid;
  v_batch uuid;
  v_r1 uuid;
  i int;
begin
  select id into v_najdi from dialects where slug = 'najdi';
  if v_najdi is null then
    return; -- dialects not seeded yet in this environment; skip silently
  end if;

  if exists (select 1 from raw_word_submissions where submitted_word = 'دفعة_تلقائي_1') then
    return; -- already seeded (re-running seed.sql without a full reset)
  end if;

  insert into submission_batches (idempotency_key, consent_version, moderation_state)
  values (gen_random_uuid(), 'v1', 'received')
  returning id into v_batch;

  for i in 1..60 loop
    insert into raw_word_submissions (batch_id, submitted_word, submitted_dialect, word_search_key, dialect_search_key, review_status, position, selected_dialect_id)
    values (v_batch, 'دفعة_تلقائي_' || i, 'نجدي', 'دفعة_تلقائي_' || i, 'نجدي', 'pending', i * 2, v_najdi)
    returning id into v_r1;
    insert into raw_word_submissions (batch_id, submitted_word, submitted_dialect, word_search_key, dialect_search_key, review_status, position, selected_dialect_id)
    values (v_batch, 'دفعة_تلقائي_' || i, 'نجدي', 'دفعة_تلقائي_' || i, 'نجدي', 'new', i * 2 + 1, v_najdi);
    insert into raw_examples (raw_submission_id, sentence, sentence_search_key, position)
    values (v_r1, 'مثال دفعة تلقائي ' || i, 'مثال دفعة تلقائي ' || i, 0);
  end loop;

  insert into raw_word_submissions (batch_id, submitted_word, submitted_dialect, submitted_explanation, word_search_key, dialect_search_key, review_status, position, selected_dialect_id)
  values (v_batch, 'دفعة_تعارض_1', 'نجدي', 'معنى أول', 'دفعة_تعارض_1', 'نجدي', 'pending', 200, v_najdi)
  returning id into v_r1;
  insert into raw_examples (raw_submission_id, sentence, sentence_search_key, position)
  values (v_r1, 'مثال تعارض أول', 'مثال تعارض أول', 0);
  insert into raw_word_submissions (batch_id, submitted_word, submitted_dialect, submitted_explanation, word_search_key, dialect_search_key, review_status, position, selected_dialect_id)
  values (v_batch, 'دفعة_تعارض_1', 'نجدي', 'معنى مختلف تمامًا', 'دفعة_تعارض_1', 'نجدي', 'new', 201, v_najdi)
  returning id into v_r1;
  insert into raw_examples (raw_submission_id, sentence, sentence_search_key, position)
  values (v_r1, 'مثال تعارض ثاني', 'مثال تعارض ثاني', 0);
end $$;
