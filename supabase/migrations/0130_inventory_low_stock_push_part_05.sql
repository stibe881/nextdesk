begin;

set local search_path = pg_catalog, public;

grant execute on function public.push_claim_outbox_v2(integer) to service_role;


comment on table public.inventory_low_stock_episodes is
  'Private, auditable Unterbestandsepisoden je Mandant und Artikel; Mengen und Standorte werden nicht gespeichert.';

comment on table public.inventory_low_stock_episode_recipients is
  'Private, auditable Empfängerbelege: höchstens eine Benachrichtigung pro berechtigter Person und Unterbestandsepisode.';

comment on function public.inventory_low_stock_delivery_authorized(uuid, uuid) is
  'Service-only Zustellgrenze für Unterbestand: Featureflags, aktive Mitgliedschaft/Rolle, aktives Gerät und explizites persönliches Opt-in.';

comment on function public.inventory_evaluate_low_stock_after_event_lines() is
  'Bewertet Artikelgesamtverfügbarkeit erst nach vollständigen Ledgerzeilen eines Events und erzeugt transaktionale Unterbestandsepisoden.';

commit;
