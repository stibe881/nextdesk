-- Infrastruktur: eigene Gerätearten.
--
-- Die festen Arten (Server, Switch, …) steuern Symbole, Filter und Regeln und
-- bleiben unverändert. Für alles andere (z. B. «iLO», «Drucker», «Kamera»)
-- trägt ein Gerät der Art «other» zusätzlich eine frei benannte Art. Angezeigt
-- wird sie anstelle von «Gerät»; die Liste der eigenen Arten eines Mandanten
-- ergibt sich aus den vergebenen Bezeichnungen.

alter table public.asset_infrastructure
  add column if not exists category_label text
    check (category_label is null or char_length(btrim(category_label)) between 1 and 60);

create index if not exists asset_infrastructure_category_label_idx
  on public.asset_infrastructure (tenant_id, category_label)
  where category_label is not null;

comment on column public.asset_infrastructure.category_label is
  'Own name of the device kind, shown instead of the label of category «other». Ignored for every other category.';
