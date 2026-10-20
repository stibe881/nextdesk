begin;

-- Atomare Bearbeitung eines Ticketzusatzfelds mit Abschnitts- und Positionswechsel.
-- Ein bearbeitetes Feld darf nicht zwischen Definition und Platzierung teilweise
-- gespeichert werden. Beide inneren Funktionen prüfen die erwartete Layoutversion
-- und laufen innerhalb derselben Datenbanktransaktion.

create or replace function public.update_ticket_custom_field_definition_at_position(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_definition_id uuid,
  p_field_key text,
  p_label text,
  p_field_type text,
  p_required boolean,
  p_options jsonb,
  p_section_id uuid,
  p_position integer,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_definition jsonb;
  v_definition_id uuid;
  v_layout_version bigint;
begin
  v_definition := public.upsert_ticket_custom_field_definition(
    p_actor_id,
    p_tenant_id,
    p_definition_id,
    p_field_key,
    p_label,
    p_field_type,
    p_required,
    p_options,
    p_expected_version
  );

  if coalesce(v_definition->>'id', '') = '' then
    raise exception 'custom_field_update_failed';
  end if;
  v_definition_id := (v_definition->>'id')::uuid;

  v_layout_version := public.move_ticket_custom_field_definition(
    p_actor_id,
    p_tenant_id,
    v_definition_id,
    p_section_id,
    p_position,
    (v_definition->>'layoutVersion')::bigint
  );

  return jsonb_build_object(
    'id', v_definition_id,
    'layoutVersion', v_layout_version
  );
end;
$$;

revoke all on function public.update_ticket_custom_field_definition_at_position(
  uuid, uuid, uuid, text, text, text, boolean, jsonb, uuid, integer, bigint
) from public, anon, authenticated;
grant execute on function public.update_ticket_custom_field_definition_at_position(
  uuid, uuid, uuid, text, text, text, boolean, jsonb, uuid, integer, bigint
) to service_role;

commit;
