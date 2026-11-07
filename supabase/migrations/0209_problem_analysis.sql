begin;

set local search_path = pg_catalog, public;

-- Structured root cause analysis of a case (5 × why) and its impact.
alter table public.problems
  add column if not exists analysis jsonb not null default '{}'::jsonb
    check (jsonb_typeof(analysis) = 'object'),
  add column if not exists impact text
    check (impact is null or char_length(impact) <= 4000);

commit;
