begin;

alter table public.tenant_feature_flags
  add column if not exists pilot_ends_at timestamptz;

alter table public.tenant_feature_flags
  drop constraint if exists tenant_feature_flags_pilot_ends_at_check;

alter table public.tenant_feature_flags
  add constraint tenant_feature_flags_pilot_ends_at_check
  check (pilot_ends_at is null or enabled = true);

create index if not exists tenant_feature_flags_active_pilot_idx
  on public.tenant_feature_flags (tenant_id, pilot_ends_at)
  where pilot_ends_at is not null;

commit;
