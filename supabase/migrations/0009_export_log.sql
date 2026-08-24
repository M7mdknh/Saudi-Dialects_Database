create or replace function record_export(
  p_actor uuid,
  p_format text,
  p_schema_version integer,
  p_filters jsonb,
  p_record_count integer,
  p_checksum text
)
returns exports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row exports%rowtype;
begin
  if not is_active_admin(p_actor) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  insert into exports (created_by, format, schema_version, filters, record_count, checksum, status, completed_at)
  values (p_actor, p_format, p_schema_version, p_filters, p_record_count, p_checksum, 'completed', now())
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function record_export(uuid, text, integer, jsonb, integer, text) to authenticated;
