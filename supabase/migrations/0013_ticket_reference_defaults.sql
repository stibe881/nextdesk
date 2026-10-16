begin;

create or replace function public.initialize_tenant_ticket_reference_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ticket_statuses (tenant_id, key, label, is_closed, sort_order)
  values
    (new.id, 'new', 'Neu', false, 10),
    (new.id, 'in_progress', 'In Bearbeitung', false, 20),
    (new.id, 'waiting', 'Wartend', false, 30),
    (new.id, 'resolved', 'Gelöst', true, 40)
  on conflict (tenant_id, key) do nothing;

  insert into public.ticket_priorities (tenant_id, key, label, sort_order)
  values
    (new.id, 'low', 'Niedrig', 10),
    (new.id, 'normal', 'Normal', 20),
    (new.id, 'high', 'Hoch', 30),
    (new.id, 'urgent', 'Dringend', 40)
  on conflict (tenant_id, key) do nothing;
  return new;
end;
$$;

drop trigger if exists tenant_ticket_reference_defaults on public.tenants;
create trigger tenant_ticket_reference_defaults
  after insert on public.tenants
  for each row execute function public.initialize_tenant_ticket_reference_data();

insert into public.ticket_statuses (tenant_id, key, label, is_closed, sort_order)
select tenant.id, defaults.key, defaults.label, defaults.is_closed, defaults.sort_order
from public.tenants tenant
cross join (values
  ('new', 'Neu', false, 10),
  ('in_progress', 'In Bearbeitung', false, 20),
  ('waiting', 'Wartend', false, 30),
  ('resolved', 'Gelöst', true, 40)
) as defaults(key, label, is_closed, sort_order)
on conflict (tenant_id, key) do nothing;

insert into public.ticket_priorities (tenant_id, key, label, sort_order)
select tenant.id, defaults.key, defaults.label, defaults.sort_order
from public.tenants tenant
cross join (values
  ('low', 'Niedrig', 10),
  ('normal', 'Normal', 20),
  ('high', 'Hoch', 30),
  ('urgent', 'Dringend', 40)
) as defaults(key, label, sort_order)
on conflict (tenant_id, key) do nothing;

commit;
