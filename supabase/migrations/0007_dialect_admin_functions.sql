-- Dialect taxonomy writes go through these functions (not direct table
-- grants) so RLS on `dialects`/`dialect_aliases` can stay read-only for
-- admins while writes still require an active-admin check.
create or replace function create_dialect(p_actor uuid, p_name_ar text, p_slug text, p_parent_id uuid)
returns dialects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row dialects%rowtype;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  insert into dialects (name_ar, slug, parent_id)
  values (p_name_ar, p_slug, p_parent_id)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function create_dialect(uuid, text, text, uuid) to authenticated;

-- Records a recommendation only: mapping a recurring submitted label to a
-- canonical dialect never auto-approves anything (see data-model.md).
create or replace function create_dialect_alias(p_actor uuid, p_alias_ar text, p_dialect_id uuid)
returns dialect_aliases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row dialect_aliases%rowtype;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  insert into dialect_aliases (alias_ar, alias_search_key, dialect_id, created_by)
  values (p_alias_ar, lower(trim(p_alias_ar)), p_dialect_id, p_actor)
  on conflict (alias_search_key) do update set dialect_id = excluded.dialect_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function create_dialect_alias(uuid, text, uuid) to authenticated;
