begin;

set local search_path = pg_catalog, public;

-- Ticketvorlagen mit Formularfeldern: Eine Vorlage kann strukturierte Angaben
-- abfragen (Text, Auswahl, Checkbox, Datum, Zahl). Felder und
-- Checklistenpunkte können an eine Bedingung «Feld X = Wert» geknüpft werden.
-- Die Antworten eines erstellten Tickets werden pro Ticket gespeichert.
--
-- Wie die Vorlagen selbst werden Felder ausschliesslich über die
-- berechtigungsgeprüften Edge Functions «ticket-templates» und
-- «ticket-actions» gelesen und geschrieben. Browserrollen erhalten keine
-- Tabellenrechte. Gespeicherte Antworten dürfen alle lesen, die das Ticket
-- lesen dürfen.

-- Eine Bedingung ist entweder null (gilt immer) oder genau
-- { "fieldKey": "<schlüssel>", "equals": "<wert>" }.
create or replace function public.ticket_template_condition_valid(p_condition jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select case
    when p_condition is null then true
    when jsonb_typeof(p_condition) <> 'object' then false
    else
      (select count(*) from jsonb_object_keys(p_condition)) = 2
      and coalesce(jsonb_typeof(p_condition -> 'fieldKey') = 'string', false)
      and coalesce((p_condition ->> 'fieldKey') ~ '^[a-z][a-z0-9_]{0,62}$', false)
      and coalesce(jsonb_typeof(p_condition -> 'equals') = 'string', false)
      and coalesce(char_length(p_condition ->> 'equals') between 1 and 160, false)
  end;
$function$;

-- Wertet eine Bedingung gegen die Antworten eines Formulars aus. Antworten
-- werden wie im TypeScript-Modul als Text verglichen: Checkboxen als
-- «true»/«false», Zahlen in ihrer JSON-Schreibweise, Texte ohne Rand-Leerraum.
create or replace function public.ticket_template_condition_holds(
  p_condition jsonb,
  p_answers jsonb
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select case
    when p_condition is null then true
    when not public.ticket_template_condition_valid(p_condition) then false
    when p_answers is null or jsonb_typeof(p_answers) <> 'object' then false
    else coalesce(
      case jsonb_typeof(p_answers -> (p_condition ->> 'fieldKey'))
        when 'string' then btrim(p_answers ->> (p_condition ->> 'fieldKey'))
        when 'boolean' then p_answers ->> (p_condition ->> 'fieldKey')
        when 'number' then p_answers ->> (p_condition ->> 'fieldKey')
        else ''
      end,
      ''
    ) = p_condition ->> 'equals'
  end;
$function$;

create or replace function public.ticket_template_field_options_valid(p_options text[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select p_options is not null
    and cardinality(p_options) <= 50
    and array_position(p_options, null) is null
    and not exists (
      select 1 from unnest(p_options) option_value
      where char_length(btrim(option_value)) not between 1 and 160
    )
    and (select count(distinct option_value) from unnest(p_options) option_value)
      = cardinality(p_options);
$function$;

revoke all on function public.ticket_template_condition_valid(jsonb) from public, anon, authenticated;
revoke all on function public.ticket_template_condition_holds(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.ticket_template_field_options_valid(text[]) from public, anon, authenticated;
grant execute on function public.ticket_template_condition_valid(jsonb) to service_role;
grant execute on function public.ticket_template_condition_holds(jsonb, jsonb) to service_role;
grant execute on function public.ticket_template_field_options_valid(text[]) to service_role;

create table if not exists public.ticket_template_fields (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid not null,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  label text not null check (char_length(btrim(label)) between 1 and 160),
  field_type text not null
    check (field_type in ('text', 'textarea', 'select', 'checkbox', 'date', 'number')),
  required boolean not null default false,
  options text[] not null default '{}'::text[]
    check (public.ticket_template_field_options_valid(options)),
  help_text text check (help_text is null or char_length(help_text) <= 500),
  position integer not null default 0 check (position between 0 and 1000),
  condition jsonb check (public.ticket_template_condition_valid(condition)),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ticket_template_fields_template_tenant_fk
    foreign key (template_id, tenant_id)
    references public.ticket_templates (id, tenant_id)
    on delete cascade,
  constraint ticket_template_fields_template_key_unique unique (template_id, key),
  -- Nur Auswahlfelder haben Optionen, und sie brauchen mindestens eine.
  constraint ticket_template_fields_select_options
    check ((field_type = 'select') = (cardinality(options) > 0)),
  constraint ticket_template_fields_condition_not_self
    check (condition is null or condition ->> 'fieldKey' <> key)
);

create index if not exists ticket_template_fields_template_position_idx
  on public.ticket_template_fields (tenant_id, template_id, position, id);

alter table public.ticket_template_fields enable row level security;
alter table public.ticket_template_fields force row level security;
revoke all on table public.ticket_template_fields from public, anon, authenticated;
grant all on table public.ticket_template_fields to service_role;

-- Checklistenpunkte einer Vorlage entstehen nur, wenn ihre Bedingung gilt.
-- null bedeutet wie bisher: immer.
alter table public.ticket_template_checklist_items
  add column if not exists condition jsonb
    constraint ticket_template_checklist_items_condition_valid
    check (public.ticket_template_condition_valid(condition));

-- Antworten eines mit Vorlage erstellten Tickets. «fields» hält eine Kopie
-- der Feldbezeichnungen zum Zeitpunkt der Erstellung, damit spätere
-- Vorlagenänderungen die Anzeige im Ticket nicht verfälschen.
create table if not exists public.ticket_form_answers (
  ticket_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid,
  answers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 131072),
  fields jsonb not null default '[]'::jsonb
    check (jsonb_typeof(fields) = 'array' and pg_column_size(fields) <= 131072),
  created_at timestamptz not null default timezone('utc', now()),
  constraint ticket_form_answers_ticket_tenant_fk
    foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id)
    on delete cascade,
  constraint ticket_form_answers_template_tenant_fk
    foreign key (template_id, tenant_id)
    references public.ticket_templates (id, tenant_id)
    on delete set null (template_id)
);

create index if not exists ticket_form_answers_template_idx
  on public.ticket_form_answers (tenant_id, template_id)
  where template_id is not null;

alter table public.ticket_form_answers enable row level security;
alter table public.ticket_form_answers force row level security;
revoke all on table public.ticket_form_answers from public, anon, authenticated;
grant select on table public.ticket_form_answers to authenticated;
grant all on table public.ticket_form_answers to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ticket_form_answers'
      and policyname = 'ticket_form_answers_select_authorized'
  ) then
    create policy ticket_form_answers_select_authorized
      on public.ticket_form_answers
      for select to authenticated
      using (public.can_read_ticket(ticket_id));
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
