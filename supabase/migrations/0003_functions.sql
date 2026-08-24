-- Trigger + domain functions. Domain-mutating functions run as SECURITY
-- DEFINER so they can be granted narrowly to authenticated admins without
-- granting them raw table UPDATE/DELETE privileges; each function still
-- re-checks admin authorization internally.

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_raw_word_submissions_updated_at on raw_word_submissions;
create trigger trg_raw_word_submissions_updated_at
  before update on raw_word_submissions
  for each row execute function set_updated_at();

drop trigger if exists trg_dialects_updated_at on dialects;
create trigger trg_dialects_updated_at
  before update on dialects
  for each row execute function set_updated_at();

drop trigger if exists trg_dialect_aliases_updated_at on dialect_aliases;
create trigger trg_dialect_aliases_updated_at
  before update on dialect_aliases
  for each row execute function set_updated_at();

drop trigger if exists trg_canonical_entries_updated_at on canonical_entries;
create trigger trg_canonical_entries_updated_at
  before update on canonical_entries
  for each row execute function set_updated_at();

drop trigger if exists trg_canonical_examples_updated_at on canonical_examples;
create trigger trg_canonical_examples_updated_at
  before update on canonical_examples
  for each row execute function set_updated_at();

-- Authorization helper: authentication alone is not authorization.
create or replace function is_active_admin(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from admins where user_id = p_user and is_active = true
  );
$$;

grant execute on function is_active_admin(uuid) to authenticated, anon;

-- Atomic batch insertion. Called by the validated /api/submissions route
-- using the service-role client, after Zod validation and search-key
-- derivation have already happened in application code. Idempotent: a
-- repeated idempotency_key returns the original batch instead of inserting
-- a duplicate.
create or replace function submit_batch(
  p_idempotency_key uuid,
  p_consent_version text,
  p_words jsonb,
  p_abuse_hash text,
  p_abuse_hash_expires_at timestamptz
)
returns table (batch_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_word jsonb;
  v_example jsonb;
  v_submission_id uuid;
  v_word_position integer := 0;
begin
  select id into v_batch_id from submission_batches where idempotency_key = p_idempotency_key;
  if v_batch_id is not null then
    return query select v_batch_id, false;
    return;
  end if;

  if jsonb_array_length(p_words) < 1 or jsonb_array_length(p_words) > 50 then
    raise exception 'invalid_word_count' using errcode = '22023';
  end if;

  insert into submission_batches (idempotency_key, consent_version, abuse_hash, abuse_hash_expires_at)
  values (p_idempotency_key, p_consent_version, p_abuse_hash, p_abuse_hash_expires_at)
  returning id into v_batch_id;

  for v_word in select * from jsonb_array_elements(p_words)
  loop
    if jsonb_array_length(v_word -> 'examples') < 1 then
      raise exception 'missing_example' using errcode = '22023';
    end if;

    insert into raw_word_submissions (
      batch_id, submitted_word, submitted_dialect, submitted_msa_synonym,
      submitted_explanation, word_search_key, dialect_search_key, position
    ) values (
      v_batch_id,
      v_word ->> 'word',
      v_word ->> 'dialect',
      v_word ->> 'msaSynonym',
      nullif(v_word ->> 'explanation', ''),
      v_word ->> 'wordSearchKey',
      v_word ->> 'dialectSearchKey',
      v_word_position
    )
    returning id into v_submission_id;

    for v_example in select * from jsonb_array_elements(v_word -> 'examples')
    loop
      insert into raw_examples (raw_submission_id, sentence, sentence_search_key, position)
      values (
        v_submission_id,
        v_example ->> 'sentence',
        v_example ->> 'sentenceSearchKey',
        coalesce((v_example ->> 'position')::integer, 0)
      );
    end loop;

    v_word_position := v_word_position + 1;
  end loop;

  return query select v_batch_id, true;
end;
$$;

-- Marks a submission seen by an admin without changing its review status.
create or replace function mark_submission_seen(p_admin uuid, p_submission uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_active_admin(p_admin) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  insert into admin_submission_views (admin_id, raw_submission_id, first_seen_at, last_seen_at)
  values (p_admin, p_submission, now(), now())
  on conflict (admin_id, raw_submission_id)
  do update set last_seen_at = now();
end;
$$;

grant execute on function mark_submission_seen(uuid, uuid) to authenticated;

-- Approve / reject / mark-duplicate / return-to-pending a raw submission,
-- with optimistic concurrency and an auditable review event.
create or replace function review_raw_submission(
  p_actor uuid,
  p_submission_id uuid,
  p_new_status text,
  p_expected_updated_at timestamptz
)
returns table (id uuid, review_status text, updated_at timestamptz, stale boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_current timestamptz;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_new_status not in ('pending', 'approved', 'rejected', 'duplicate') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select updated_at, to_jsonb(raw_word_submissions.*) into v_current, v_before
  from raw_word_submissions where raw_word_submissions.id = p_submission_id
  for update;

  if v_current is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_expected_updated_at is not null and v_current <> p_expected_updated_at then
    return query select p_submission_id, (v_before ->> 'review_status')::text, v_current, true;
    return;
  end if;

  update raw_word_submissions
  set review_status = p_new_status
  where raw_word_submissions.id = p_submission_id
  returning raw_word_submissions.updated_at into v_current;

  insert into review_events (raw_submission_id, actor_id, action, before_state, after_state)
  values (
    p_submission_id, p_actor, 'status_change', v_before,
    jsonb_set(v_before, '{review_status}', to_jsonb(p_new_status))
  );

  return query select p_submission_id, p_new_status, v_current, false;
end;
$$;

grant execute on function review_raw_submission(uuid, uuid, text, timestamptz) to authenticated;

-- Inline edit of canonical fields (approve-and-edit / reclassify), with
-- optimistic concurrency on `version`.
create or replace function upsert_canonical_entry(
  p_actor uuid,
  p_entry_id uuid,
  p_expected_version integer,
  p_canonical_word text,
  p_canonical_word_search_key text,
  p_canonical_dialect_id uuid,
  p_canonical_msa_synonyms text[],
  p_canonical_explanation text,
  p_editorial_status text
)
returns table (id uuid, version integer, stale boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_current_version integer;
  v_id uuid;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_entry_id is null then
    insert into canonical_entries (
      canonical_word, canonical_word_search_key, canonical_dialect_id,
      canonical_msa_synonyms, canonical_explanation, editorial_status,
      approved_by, approved_at
    ) values (
      p_canonical_word, p_canonical_word_search_key, p_canonical_dialect_id,
      p_canonical_msa_synonyms, nullif(p_canonical_explanation, ''), p_editorial_status,
      case when p_editorial_status = 'approved' then p_actor end,
      case when p_editorial_status = 'approved' then now() end
    )
    returning canonical_entries.id, canonical_entries.version into v_id, v_current_version;

    insert into review_events (canonical_entry_id, actor_id, action, before_state, after_state)
    values (v_id, p_actor, 'create', null, to_jsonb(row(v_id)));

    return query select v_id, v_current_version, false;
    return;
  end if;

  select version, to_jsonb(canonical_entries.*) into v_current_version, v_before
  from canonical_entries where canonical_entries.id = p_entry_id
  for update;

  if v_current_version is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_expected_version is not null and v_current_version <> p_expected_version then
    return query select p_entry_id, v_current_version, true;
    return;
  end if;

  update canonical_entries set
    canonical_word = p_canonical_word,
    canonical_word_search_key = p_canonical_word_search_key,
    canonical_dialect_id = p_canonical_dialect_id,
    canonical_msa_synonyms = p_canonical_msa_synonyms,
    canonical_explanation = nullif(p_canonical_explanation, ''),
    editorial_status = p_editorial_status,
    version = version + 1,
    approved_by = case when p_editorial_status = 'approved' then p_actor else approved_by end,
    approved_at = case when p_editorial_status = 'approved' then now() else approved_at end
  where canonical_entries.id = p_entry_id
  returning canonical_entries.version into v_current_version;

  insert into review_events (canonical_entry_id, actor_id, action, before_state, after_state)
  values (p_entry_id, p_actor, 'edit', v_before, to_jsonb((select ce from canonical_entries ce where ce.id = p_entry_id)));

  return query select p_entry_id, v_current_version, false;
end;
$$;

grant execute on function upsert_canonical_entry(uuid, uuid, integer, text, text, uuid, text[], text, text) to authenticated;

-- Transactional merge: creates/updates one canonical entry from several raw
-- submissions, links every raw submission as a source (never deleting any),
-- copies the chosen examples, and marks the merged raw submissions.
create or replace function merge_submissions(
  p_actor uuid,
  p_raw_submission_ids uuid[],
  p_target_entry_id uuid,
  p_canonical_word text,
  p_canonical_word_search_key text,
  p_canonical_dialect_id uuid,
  p_canonical_msa_synonyms text[],
  p_canonical_explanation text,
  p_examples jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_before jsonb;
  v_raw_id uuid;
  v_example jsonb;
  v_is_first boolean := true;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if array_length(p_raw_submission_ids, 1) is null or array_length(p_raw_submission_ids, 1) < 1 then
    raise exception 'no_sources' using errcode = '22023';
  end if;

  if p_target_entry_id is null then
    insert into canonical_entries (
      canonical_word, canonical_word_search_key, canonical_dialect_id,
      canonical_msa_synonyms, canonical_explanation, editorial_status,
      approved_by, approved_at
    ) values (
      p_canonical_word, p_canonical_word_search_key, p_canonical_dialect_id,
      p_canonical_msa_synonyms, nullif(p_canonical_explanation, ''), 'approved', p_actor, now()
    )
    returning id into v_entry_id;
  else
    v_entry_id := p_target_entry_id;
    select to_jsonb(canonical_entries.*) into v_before from canonical_entries where id = v_entry_id for update;
    update canonical_entries set
      canonical_word = p_canonical_word,
      canonical_word_search_key = p_canonical_word_search_key,
      canonical_dialect_id = p_canonical_dialect_id,
      canonical_msa_synonyms = p_canonical_msa_synonyms,
      canonical_explanation = nullif(p_canonical_explanation, ''),
      editorial_status = 'approved',
      version = version + 1,
      approved_by = p_actor,
      approved_at = now()
    where id = v_entry_id;
  end if;

  foreach v_raw_id in array p_raw_submission_ids loop
    insert into entry_sources (canonical_entry_id, raw_submission_id, relation, linked_by)
    values (v_entry_id, v_raw_id, case when v_is_first then 'primary' else 'merged' end, p_actor)
    on conflict (canonical_entry_id, raw_submission_id) do nothing;

    update raw_word_submissions set review_status = 'merged' where id = v_raw_id;
    v_is_first := false;
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
    on conflict (canonical_entry_id, sentence_search_key) do nothing;
  end loop;

  insert into review_events (canonical_entry_id, actor_id, action, before_state, after_state)
  values (
    v_entry_id, p_actor, 'merge', v_before,
    jsonb_build_object('canonical_entry_id', v_entry_id, 'source_ids', p_raw_submission_ids)
  );

  return v_entry_id;
end;
$$;

grant execute on function merge_submissions(uuid, uuid[], uuid, text, text, uuid, text[], text, jsonb) to authenticated;

-- Restores the previous editorial snapshot recorded on a review event
-- (approve/reject/edit/merge undo). Raw submissions and sources are never
-- deleted; undo only restores status/canonical field values.
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
      version = version + 1
    where id = v_event.canonical_entry_id;
  end if;

  insert into review_events (raw_submission_id, canonical_entry_id, actor_id, action, before_state, after_state)
  values (v_event.raw_submission_id, v_event.canonical_entry_id, p_actor, 'undo', to_jsonb(v_event), v_event.before_state);
end;
$$;

grant execute on function undo_review_event(uuid, uuid) to authenticated;
