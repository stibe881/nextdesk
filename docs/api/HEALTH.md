# Health-Endpunkt

**Produkt:** nextDesk

**Endpunkt:** `GET` oder `POST /functions/v1/health`

Der Health-Endpunkt ist bewusst öffentlich und liefert ausschliesslich einen
kleinen Statusumschlag. Er liest keine Mandanten-, Benutzer- oder
Konfigurationsdaten und gibt keine Versions-, Infrastruktur- oder Geheimnisdaten
preis.

```json
{
  "status": "ok",
  "service": "nextdesk",
  "time": "2026-10-18T15:00:00.000Z"
}
```

- `status` ist immer `"ok"`.
- `service` ist immer `"nextdesk"`.
- `time` ist ein ISO-8601-Zeitpunkt in UTC.
- `Cache-Control: no-store` verhindert das Caching.
- CORS wird ausschliesslich für `https://app.nextdesk.ch` ausgegeben. Aufrufe ohne `Origin` sind zulässig; andere vorhandene Origins erhalten `403`.
- `OPTIONS` dient nur dem CORS-Preflight. Andere Methoden als `GET`, `POST` und `OPTIONS` erhalten `405`.

## Bereitstellung

> Die Function **muss mit `verify_jwt = false` bereitgestellt werden**, damit ein Load Balancer oder eine öffentliche Verfügbarkeitsprüfung sie ohne Anmeldung erreichen kann.

Die Funktionskonfiguration muss vor einer Bereitstellung mindestens diesen Eintrag
enthalten:

```toml
[functions.health]
verify_jwt = false
```

Es werden keine Credentials, keine Mandanten-ID und kein Request-Body benötigt.
