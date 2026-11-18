-- formality-ok-file: enthält bewusst beide Fassungen (du und Sie) der Texte, die die Datenbank erzeugt.
begin;

set local search_path = pg_catalog, public;

-- Ticket-Ablauf: Wochenenden zählen nicht mit.
--
-- Erinnern, automatisch Lösen und automatisch Schliessen rechnen mit
-- Werktagen (Montag bis Freitag, Zeit Europe/Zurich) statt mit Kalendertagen.
-- Ein Ticket, das am Freitagnachmittag auf eine Rückmeldung wartet, wird also
-- nicht schon am Montag erinnert oder gelöst, sondern erst nach der
-- eingestellten Zahl Werktage. Dazu kommt: Der Satz «Ist Ihr Problem
-- inzwischen gelöst?» der automatischen Erinnerung folgt jetzt der Anrede des
-- Mandanten (vorher stand dort in der du-Fassung noch «Ihr»).

-- Zeit zwischen zwei Zeitpunkten ohne Samstag und Sonntag (Wanduhr Europe/Zurich).
create or replace function public.working_time_between(p_from timestamptz, p_to timestamptz)
returns interval
language sql
stable
set search_path = pg_catalog
as $$
  with bounds as (
    select timezone('Europe/Zurich', p_from) as from_local,
           timezone('Europe/Zurich', p_to) as to_local
  )
  select coalesce(
    sum(
      least(day + interval '1 day', bounds.to_local)
      - greatest(day, bounds.from_local)
    ),
    interval '0'
  )
  from bounds,
       generate_series(
         date_trunc('day', bounds.from_local),
         date_trunc('day', bounds.to_local),
         interval '1 day'
       ) as day
  where bounds.to_local > bounds.from_local
    and extract(isodow from day) < 6;
$$;

revoke all on function public.working_time_between(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.working_time_between(timestamptz, timestamptz)
  to service_role;

create or replace function pg_temp.patch_function(
  p_signature regprocedure,
  p_from text,
  p_to text,
  p_expected integer
) returns void
language plpgsql
as $patch$
declare
  v_def text := pg_get_functiondef(p_signature);
  v_found integer := (length(v_def) - length(replace(v_def, p_from, ''))) / length(p_from);
begin
  if v_found <> p_expected then
    raise exception '% : % Treffer statt %', p_signature, v_found, p_expected;
  end if;
  execute replace(v_def, p_from, p_to);
end;
$patch$;

-- 1. Erste Erinnerung: Werktage seit Beginn der Wartezeit.
select pg_temp.patch_function(
  'public.ticket_lifecycle_run()'::regprocedure,
  E'and ticket.waiting_since <= v_now - make_interval(days => settings.waiting_reminder_days)\n',
  E'and ticket.waiting_since <= v_now - make_interval(days => settings.waiting_reminder_days)\n'
  || E'      and public.working_time_between(ticket.waiting_since, v_now)\n'
  || E'        >= make_interval(days => settings.waiting_reminder_days)\n',
  1);

-- 2. Weitere Erinnerungen: Werktage seit der letzten Erinnerung.
select pg_temp.patch_function(
  'public.ticket_lifecycle_run()'::regprocedure,
  E'and ticket.waiting_reminder_sent_at\n            <= v_now - make_interval(days => settings.waiting_reminder_days)',
  E'and ticket.waiting_reminder_sent_at\n            <= v_now - make_interval(days => settings.waiting_reminder_days)\n'
  || E'          and public.working_time_between(ticket.waiting_reminder_sent_at, v_now)\n'
  || E'            >= make_interval(days => settings.waiting_reminder_days)',
  1);

-- 3. Verbleibende Tage im Erinnerungstext: Werktage.
select pg_temp.patch_function(
  'public.ticket_lifecycle_run()'::regprocedure,
  'extract(epoch from (v_now - v_ticket.waiting_since))',
  'extract(epoch from public.working_time_between(v_ticket.waiting_since, v_now))',
  1);

-- 4. Automatisch lösen.
select pg_temp.patch_function(
  'public.ticket_lifecycle_run()'::regprocedure,
  E'and ticket.waiting_since <= v_now - make_interval(days => settings.waiting_resolve_days)\n',
  E'and ticket.waiting_since <= v_now - make_interval(days => settings.waiting_resolve_days)\n'
  || E'      and public.working_time_between(ticket.waiting_since, v_now)\n'
  || E'        >= make_interval(days => settings.waiting_resolve_days)\n',
  1);

-- 5. Automatisch schliessen.
select pg_temp.patch_function(
  'public.ticket_lifecycle_run()'::regprocedure,
  E'and ticket.resolved_at <= v_now - make_interval(days => settings.resolved_close_days)\n',
  E'and ticket.resolved_at <= v_now - make_interval(days => settings.resolved_close_days)\n'
  || E'      and public.working_time_between(ticket.resolved_at, v_now)\n'
  || E'        >= make_interval(days => settings.resolved_close_days)\n',
  1);

-- 6. Text: Werktage statt Tage, richtige Einzahl.
select pg_temp.patch_function(
  'public.ticket_lifecycle_run()'::regprocedure,
  $f$' weiteren Tagen als gelöst markiert.'$f$,
  $t$case when v_remaining = 1
            then ' weiterem Werktag als gelöst markiert.'
            else ' weiteren Werktagen als gelöst markiert.'
          end$t$,
  1);

-- 7. Anrede im zweiten Absatz der Erinnerung.
select pg_temp.patch_function(
  'public.ticket_lifecycle_run()'::regprocedure,
  $f$'Ist Ihr Problem inzwischen gelöst? Dann genügt ein Klick auf «Problem ist gelöst» '$f$,
  $t$case when public.tenant_formality(v_ticket.tenant_id) = 'sie'
            then 'Ist Ihr Problem inzwischen gelöst? Dann genügt ein Klick auf «Problem ist gelöst» '
            else 'Ist dein Problem inzwischen gelöst? Dann genügt ein Klick auf «Problem ist gelöst» '
          end$t$,
  1);

-- Bereits gespeicherte Erinnerungen in Mandanten mit «du» auf die du-Fassung bringen.
update public.ticket_comments comment
   set body = replace(comment.body, 'Ist Ihr Problem inzwischen gelöst?', 'Ist dein Problem inzwischen gelöst?')
  from public.tickets ticket
 where ticket.id = comment.ticket_id
   and comment.body like E'Hallo\n\nWir warten noch auf deine Rückmeldung zu Ticket %Ist Ihr Problem inzwischen gelöst?%'
   and public.tenant_formality(ticket.tenant_id) = 'du';

commit;
