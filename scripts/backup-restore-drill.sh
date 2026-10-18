#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="$(pg_config --bindir)"
DRILL_DIR="$(mktemp -d /tmp/nextdesk-backup-restore.XXXXXX)"
PG_DATA="$DRILL_DIR/data"
PG_SOCKET="$DRILL_DIR/socket"
DUMP_FILE="$DRILL_DIR/nextdesk-drill.dump"
PG_PORT="$((55000 + RANDOM % 1000))"
PG_USER="nextdesk_backup_drill"
SOURCE_DB="nextdesk_drill_source"
RESTORED_DB="nextdesk_drill_restored"

now_ms() {
  date +%s%3N
}

cleanup() {
  if [[ -f "$PG_DATA/postmaster.pid" ]]; then
    "$PG_BIN/pg_ctl" -D "$PG_DATA" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$DRILL_DIR"
}
trap cleanup EXIT

compare_files() {
  local label="$1"
  local source_file="$2"
  local restored_file="$3"

  if ! diff -u "$source_file" "$restored_file"; then
    echo "Abgleich fehlgeschlagen: $label" >&2
    exit 1
  fi
}

list_tables() {
  local database="$1"
  psql -X -qAt -d "$database" -c "
    select n.nspname || '.' || c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('auth', 'public')
      and c.relkind in ('r', 'p')
    order by 1;
  "
}

row_counts() {
  local database="$1"
  psql -X -qAt -d "$database" <<'SQL'
select format(
  'select %L || ''.'' || %L || ''='' || count(*) from %I.%I;',
  n.nspname,
  c.relname,
  n.nspname,
  c.relname
)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('auth', 'public')
  and c.relkind in ('r', 'p')
order by n.nspname, c.relname;
\gexec
SQL
}

rls_flags() {
  local database="$1"
  psql -X -qAt -d "$database" -c "
    select n.nspname || '.' || c.relname || '=' || c.relrowsecurity || ':' || c.relforcerowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('auth', 'public')
      and c.relkind in ('r', 'p')
    order by 1;
  "
}

mkdir -p "$PG_SOCKET"
"$PG_BIN/initdb" -D "$PG_DATA" --auth=trust --username="$PG_USER" --no-instructions >/dev/null
"$PG_BIN/pg_ctl" -D "$PG_DATA" -o "-k $PG_SOCKET -p $PG_PORT" -w start >/dev/null

export PGHOST="$PG_SOCKET"
export PGPORT="$PG_PORT"
export PGUSER="$PG_USER"

started_at="$(now_ms)"
createdb "$SOURCE_DB"
psql -X -v ON_ERROR_STOP=1 -d "$SOURCE_DB" <<'SQL' >/dev/null
create schema auth;
create table auth.users (
  id uuid primary key,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
SQL

migration_started_at="$(now_ms)"
for migration in "$ROOT_DIR"/supabase/migrations/*.sql; do
  psql -X -v ON_ERROR_STOP=1 -d "$SOURCE_DB" -f "$migration" >/dev/null
done
migration_finished_at="$(now_ms)"

psql -X -v ON_ERROR_STOP=1 -d "$SOURCE_DB" <<'SQL' >/dev/null
insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000102');

insert into public.user_profiles (id, display_name) values
  ('00000000-0000-4000-8000-000000000101', 'Wiederherstellung Anfragende'),
  ('00000000-0000-4000-8000-000000000102', 'Wiederherstellung Agent');

insert into public.tenants (id, slug, name) values
  ('10000000-0000-4000-8000-000000000101', 'restore-drill', 'Restore Drill');

insert into public.departments (id, tenant_id, key, name, kind) values
  ('11000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', 'ict', 'ICT', 'ict');

insert into public.tenant_memberships (tenant_id, user_id, status, joined_at) values
  ('10000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101', 'active', now()),
  ('10000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102', 'active', now());

insert into public.ticket_statuses (id, tenant_id, key, label, sort_order) values
  ('13000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', 'drill_open', 'Drill offen', 99);

insert into public.ticket_priorities (id, tenant_id, key, label, sort_order) values
  ('14000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', 'drill_normal', 'Drill normal', 99);

insert into public.tickets (
  id,
  tenant_id,
  department_id,
  ticket_number,
  subject,
  description,
  status_id,
  priority_id,
  requester_id
) values (
  '17000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000101',
  '11000000-0000-4000-8000-000000000101',
  'ICT-DRILL-000001',
  'Lokaler Wiederherstellungsnachweis',
  'Beispieldaten ausschliesslich für den lokalen Backup- und Restore-Drill.',
  '13000000-0000-4000-8000-000000000101',
  '14000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000101'
);

insert into public.ticket_comments (ticket_id, author_id, body) values
  ('17000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102', 'Lokaler Drill-Kommentar.');
SQL

list_tables "$SOURCE_DB" > "$DRILL_DIR/source-tables.txt"
row_counts "$SOURCE_DB" | sort > "$DRILL_DIR/source-rows.txt"
rls_flags "$SOURCE_DB" > "$DRILL_DIR/source-rls.txt"

backup_started_at="$(now_ms)"
pg_dump --format=custom --no-owner --no-privileges --file="$DUMP_FILE" "$SOURCE_DB"
backup_finished_at="$(now_ms)"

createdb "$RESTORED_DB"
restore_started_at="$(now_ms)"
pg_restore --exit-on-error --no-owner --no-privileges --dbname="$RESTORED_DB" "$DUMP_FILE" >/dev/null
restore_finished_at="$(now_ms)"

list_tables "$RESTORED_DB" > "$DRILL_DIR/restored-tables.txt"
row_counts "$RESTORED_DB" | sort > "$DRILL_DIR/restored-rows.txt"
rls_flags "$RESTORED_DB" > "$DRILL_DIR/restored-rls.txt"

compare_files "Tabellen" "$DRILL_DIR/source-tables.txt" "$DRILL_DIR/restored-tables.txt"
compare_files "Zeilenzahlen" "$DRILL_DIR/source-rows.txt" "$DRILL_DIR/restored-rows.txt"
compare_files "RLS-Flags" "$DRILL_DIR/source-rls.txt" "$DRILL_DIR/restored-rls.txt"

migration_count="$(find "$ROOT_DIR/supabase/migrations" -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')"
table_count="$(wc -l < "$DRILL_DIR/source-tables.txt" | tr -d ' ')"
row_count="$(awk -F= '{ total += $2 } END { print total + 0 }' "$DRILL_DIR/source-rows.txt")"
rls_enabled_count="$(awk -F= '$2 ~ /^t/ { count += 1 } END { print count + 0 }' "$DRILL_DIR/source-rls.txt")"
total_finished_at="$(now_ms)"

printf 'Backup- und Restore-Drill erfolgreich.\n'
printf 'Migrationen: %s; Tabellen: %s; Datenzeilen: %s; RLS aktiviert: %s.\n' "$migration_count" "$table_count" "$row_count" "$rls_enabled_count"
printf 'Dauer: Migrationen %s ms; Dump %s ms; Restore %s ms; Gesamt %s ms.\n' \
  "$((migration_finished_at - migration_started_at))" \
  "$((backup_finished_at - backup_started_at))" \
  "$((restore_finished_at - restore_started_at))" \
  "$((total_finished_at - started_at))"
