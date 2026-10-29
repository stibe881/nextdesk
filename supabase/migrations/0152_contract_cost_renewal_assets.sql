begin;

-- Zusätzliche Angaben zu Verträgen: Kündigung, Kosten, automatische
-- Verlängerung und verknüpfte Assets.
alter table public.contracts
  add column if not exists cancelled boolean not null default false,
  add column if not exists cancelled_on date,
  add column if not exists cost_amount numeric(12, 2)
    check (cost_amount is null or cost_amount >= 0),
  add column if not exists cost_currency text not null default 'CHF'
    check (cost_currency in ('CHF', 'EUR', 'USD')),
  add column if not exists cost_period text
    check (cost_period is null or cost_period in ('one_time', 'monthly', 'quarterly', 'yearly')),
  add column if not exists auto_renew boolean not null default false,
  add column if not exists renewal_months integer
    check (renewal_months is null or renewal_months between 1 and 120);

alter table public.contracts
  drop constraint if exists contracts_cost_period_required,
  add constraint contracts_cost_period_required
    check (cost_amount is null or cost_period is not null),
  drop constraint if exists contracts_cancelled_on_requires_cancelled,
  add constraint contracts_cancelled_on_requires_cancelled
    check (cancelled or cancelled_on is null),
  drop constraint if exists contracts_renewal_requires_auto_renew,
  add constraint contracts_renewal_requires_auto_renew
    check (auto_renew or renewal_months is null);

create table if not exists public.contract_assets (
  contract_id uuid not null,
  asset_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (contract_id, asset_id),
  constraint contract_assets_contract_fk
    foreign key (contract_id, tenant_id)
    references public.contracts (id, tenant_id) on delete cascade,
  constraint contract_assets_asset_fk
    foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete cascade
);
create index if not exists contract_assets_asset_idx
  on public.contract_assets (tenant_id, asset_id);

alter table public.contract_assets enable row level security;
revoke all on table public.contract_assets from public, anon, authenticated, service_role;
grant select, insert, delete on table public.contract_assets to service_role;

comment on table public.contract_assets is
  'Links contracts to assets of the same tenant. Browser roles use the contracts Edge Function only.';

create or replace function public.create_due_expiry_reminders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_record record;
  v_today date := timezone('Europe/Zurich', now())::date;
  v_ticket_id uuid;
  v_created integer := 0;
  v_kind text;
  v_cancel_on date;
  v_description text;
begin
  for v_kind in select unnest(array['contract', 'license']) loop
    if v_kind = 'license' and to_regclass('public.licenses') is null then
      continue;
    end if;
    for v_record in execute format($q$
      select item.id, item.tenant_id, item.title, item.ends_on,
             item.notice_period_days, item.reference_number,
             item.%1$s as party, item.reminder_days_before,
             coalesce(item.responsible_user_id, item.created_by) as requester_id,
             %4$s as auto_renew
      from public.%2$I item
      where item.status = 'active'
        and item.archived_at is null
        and item.ends_on is not null
        and item.reminder_days_before is not null
        %3$s
        and $1 >= item.ends_on - item.reminder_days_before
        and item.reminder_sent_for is distinct from item.ends_on
        and exists (
          select 1 from public.tenant_feature_flags flag
          where flag.tenant_id = item.tenant_id
            and flag.feature_key = 'contracts.management'
            and flag.enabled
            and (flag.pilot_ends_at is null or flag.pilot_ends_at > timezone('utc', now()))
        )
      order by item.ends_on, item.id
      for update of item skip locked
      limit 100
    $q$, case when v_kind = 'contract' then 'counterparty_name' else 'vendor_name' end,
         case when v_kind = 'contract' then 'contracts' else 'licenses' end,
         -- Ein bereits gekündigter Vertrag läuft planmässig aus.
         case when v_kind = 'contract' then 'and not item.cancelled' else '' end,
         case when v_kind = 'contract' then 'item.auto_renew' else 'false' end)
      using v_today
    loop
      v_cancel_on := case
        when v_record.notice_period_days is null then null
        else v_record.ends_on - v_record.notice_period_days
      end;
      v_description := format(
        E'%s läuft am %s aus.\n\n%s: %s%s%s\n\nBitte rechtzeitig prüfen, verlängern oder kündigen.',
        case when v_kind = 'contract' then 'Der Vertrag' else 'Die Lizenz' end,
        to_char(v_record.ends_on, 'DD.MM.YYYY'),
        case when v_kind = 'contract' then 'Gegenpartei' else 'Hersteller' end,
        v_record.party,
        case when v_record.reference_number is null then ''
             else E'\nNummer: ' || v_record.reference_number end,
        case when v_cancel_on is null then ''
             else E'\nKündigungsfrist: ' || v_record.notice_period_days
               || ' Tage (spätestens bis ' || to_char(v_cancel_on, 'DD.MM.YYYY') || ')' end
      ) || case when v_record.auto_renew
                then E'\n\nAchtung: Der Vertrag verlängert sich automatisch, wenn er nicht rechtzeitig gekündigt wird.'
                else '' end;
      v_ticket_id := public.create_expiry_reminder_ticket(
        v_record.tenant_id,
        v_record.requester_id,
        format('%s läuft bald aus: %s (%s)',
               case when v_kind = 'contract' then 'Vertrag' else 'Lizenz' end,
               v_record.title, to_char(v_record.ends_on, 'DD.MM.YYYY')),
        v_description
      );
      if v_ticket_id is null then
        continue;
      end if;
      execute format(
        'update public.%I set reminder_ticket_id = $1, reminder_sent_for = $2 where id = $3',
        case when v_kind = 'contract' then 'contracts' else 'licenses' end
      ) using v_ticket_id, v_record.ends_on, v_record.id;
      v_created := v_created + 1;
    end loop;
  end loop;
  return v_created;
end;
$$;
revoke all on function public.create_due_expiry_reminders()
  from public, anon, authenticated;
grant execute on function public.create_due_expiry_reminders() to service_role;

commit;
