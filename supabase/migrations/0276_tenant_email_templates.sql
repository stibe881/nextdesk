begin;

set local search_path = pg_catalog, public;

-- Angepasste Texte und Versand-Schalter der automatisch versendeten E-Mails.
-- Ohne Zeile gelten die Standardtexte und der Versand ist eingeschaltet.
-- Zugriff nur über die Edge Function «email-templates» und den Mail-Worker.
create table if not exists public.tenant_email_templates (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_key text not null check (template_key ~ '^[a-z_]{1,64}$'),
  enabled boolean not null default true,
  fields jsonb not null default '{}'::jsonb
    check (jsonb_typeof(fields) = 'object'),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, template_key)
);

alter table public.tenant_email_templates enable row level security;

revoke all on public.tenant_email_templates from anon, authenticated;
grant select, insert, update, delete on public.tenant_email_templates
  to service_role;

commit;
