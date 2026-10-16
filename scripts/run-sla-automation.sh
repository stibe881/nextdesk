#!/usr/bin/env bash
# Runs the secured nextDesk SLA automation from a trusted scheduler.
# The secret is loaded from a file outside the web root and never printed.
set -euo pipefail

ENV_FILE="${NEXTDESK_SLA_ENV_FILE:-$HOME/.config/nextdesk/sla-automation.env}"
AUTOMATION_URL="${NEXTDESK_SLA_AUTOMATION_URL:-https://ewizsylzrwogsztsthbl.supabase.co/functions/v1/sla-automation}"
CURL_BIN="${CURL_BIN:-/usr/bin/curl}"

if [[ ! -r "$ENV_FILE" ]]; then
  printf 'SLA-Automation: Secret-Datei nicht lesbar: %s\n' "$ENV_FILE" >&2
  exit 64
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [[ -z "${SLA_AUTOMATION_SECRET:-}" ]]; then
  printf 'SLA-Automation: SLA_AUTOMATION_SECRET ist nicht gesetzt.\n' >&2
  exit 64
fi

response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

status="$($CURL_BIN \
  --silent \
  --show-error \
  --output "$response_file" \
  --write-out '%{http_code}' \
  --connect-timeout 15 \
  --max-time 55 \
  --retry 2 \
  --retry-delay 2 \
  --retry-connrefused \
  --request POST \
  --header 'Content-Type: application/json' \
  --header "X-NextDesk-Automation-Secret: $SLA_AUTOMATION_SECRET" \
  --data '{"dryRun":false,"limit":100}' \
  "$AUTOMATION_URL")"

if [[ ! "$status" =~ ^2 ]]; then
  printf 'SLA-Automation fehlgeschlagen (HTTP %s). Antwort: %s\n' \
    "$status" "$(tr -d '\n' < "$response_file" | cut -c1-500)" >&2
  exit 1
fi

printf 'SLA-Automation erfolgreich (HTTP %s): %s\n' \
  "$status" "$(tr -d '\n' < "$response_file" | cut -c1-500)"
