# Experience Hub und AI Assist: API-Vertrag

**Gültig für:** nextDesk Web und iOS. Diese Spezifikation ist der verbindliche Vertrag für UI-Clients; sie müssen die Edge-Function-Quellen nicht lesen.

## Gemeinsame Aufrufregeln

Beide Endpunkte werden ausschliesslich über Supabase Edge Functions aufgerufen:

```ts
const { data, error } = await supabase.functions.invoke("experience-hub", {
  body: { type: "getWorkspacePreferences", tenantId },
});

const { data, error } = await supabase.functions.invoke("ai-assist", {
  body: { type: "getCapabilities", tenantId },
});
```

- **Methode:** `POST`; Request-Body ist ein JSON-Objekt.
- **Anmeldung:** Für jede Aktion ist eine gültige Benutzeranmeldung und eine **aktive Mitgliedschaft** im angegebenen Mandanten erforderlich.
- **Browser-Origin:** Im Browser ist nur `https://app.nextdesk.ch` zugelassen. Native Apps dürfen ohne `Origin` aufrufen.
- **Tenant-ID und IDs:** UUID v4/v1/v2/v3/v5 im kanonischen UUID-Format. Die Function normalisiert UUIDs auf Kleinbuchstaben.
- **Strikte Requests:** Unbekannte Felder, fehlende Pflichtfelder und falsche Typen führen zu `400 invalid_request`.
- **Antworten:** Erfolgreiche Antworten haben immer die Hülle `{ "data": ... }`. Fehler haben immer:

```json
{
  "error": {
    "code": "machine_readable_code",
    "message": "Deutschsprachige, nutzergeeignete Erklärung"
  }
}
```

`supabase.functions.invoke` liefert bei einem Nicht-2xx-Status zusätzlich ein Supabase-`error`-Objekt. Die UI soll den JSON-Body auswerten, wenn er verfügbar ist, und den `error.code` für programmatische Behandlung verwenden.

## Gemeinsame HTTP-Fehler

| HTTP | Code                         | Bedeutung                                                                                 |
| ---: | ---------------------------- | ----------------------------------------------------------------------------------------- |
|  400 | `invalid_request`            | Body ist kein gültiges, erwartetes JSON-Objekt oder enthält ungültige/zusätzliche Felder. |
|  401 | `authentication_required`    | Es fehlt eine gültige Anmeldung.                                                          |
|  403 | `origin_not_allowed`         | Der mitgesendete Browser-Origin ist nicht zugelassen.                                     |
|  403 | `tenant_membership_required` | Keine aktive Mitgliedschaft im angegebenen Mandanten.                                     |
|  403 | `permission_denied`          | Die Plattform- oder Datenbankberechtigung reicht nicht aus.                               |
|  405 | `method_not_allowed`         | Nur `POST` ist zulässig.                                                                  |
|  413 | `request_too_large`          | Nur Experience Hub: Request-Body grösser als 64 KiB.                                      |
|  415 | `unsupported_media_type`     | `Content-Type: application/json` fehlt.                                                   |
|  503 | `authentication_unavailable` | Die Anmeldung konnte vorübergehend nicht geprüft werden.                                  |
|  503 | `authorization_check_failed` | Mitgliedschaft oder Ticketberechtigung konnte nicht zuverlässig geprüft werden.           |

`OPTIONS` ist ausschliesslich für einen zulässigen Browser-Preflight vorgesehen und antwortet mit `204` ohne Body.

---

# `experience-hub`

## Feature-Schalter und Berechtigung

Die Function prüft zuerst Anmeldung und aktive Mandantenmitgliedschaft, danach den passenden Flag **fail-closed**. Ein fehlender, abgelaufener, fehlerhafter oder deaktivierter Flag zählt als deaktiviert.

| Aktionen                                                                                                  | erforderlicher Feature-Schlüssel | Weitere Berechtigung                                                                          |
| --------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| `getWorkspacePreferences`, `saveWorkspacePreferences`, `listFollowUps`, `saveFollowUp`, `resolveFollowUp` | `experience.workspace`           | Eigene Daten; ein verknüpftes Ticket muss für die Person lesbar sein.                         |
| `listServiceCatalog`, `confirmResolution`, `listResolutionConfirmations`                                  | `portal.self-service`            | Siehe Aktion. Es gibt **keine** Abhängigkeit von `ticketing.detail` oder `assets.management`. |

Bei deaktiviertem passenden Schalter lautet die Antwort immer `403` mit `experience_feature_disabled`.

Weitere Function-spezifische Fehler:

| HTTP | Code                            | Bedeutung                                                                                 |
| ---: | ------------------------------- | ----------------------------------------------------------------------------------------- |
|  403 | `experience_feature_disabled`   | Der zu dieser Aktion gehörige Feature-Schalter ist nicht aktiv.                           |
|  503 | `tenant_feature_lookup_failed`  | Der Feature-Schalter konnte nicht geprüft werden; Zugriff bleibt gesperrt.                |
|  503 | `experience_hub_not_configured` | Die Datenbankmigration/Relation für Experience Hub ist nicht verfügbar oder inkompatibel. |
|  500 | `invalid_stored_data`           | Gespeicherte Daten verletzen den API-Vertrag und werden deshalb nicht ausgeliefert.       |
|  500 | `operation_failed`              | Die Aktion konnte nicht abgeschlossen werden.                                             |
|  409 | `conflict`                      | Ein einmaliger Eintrag kollidiert mit einem bestehenden Datensatz.                        |
|  422 | `invalid_data`                  | Die Datenbank hat einen Wert oder eine Referenz abgewiesen.                               |

## Aktionen

### `getWorkspacePreferences`

**Feature:** `experience.workspace`

**Request**

```ts
{
  type: "getWorkspacePreferences";
  tenantId: string; // UUID, Pflicht
}
```

**Erfolg `200`**

```ts
{
  data: {
    workspacePreferences: {
      preferences: WorkspacePreferences;
      updatedAt: string | null; // ISO-8601 mit Zeitzone
    } | null;
  };
}
```

`workspacePreferences: null` bedeutet, dass noch nie Einstellungen gespeichert wurden. Die UI darf in diesem Fall ihre lokalen Standardwerte verwenden.

### `saveWorkspacePreferences`

**Feature:** `experience.workspace`

**Request**

```ts
{
  type: "saveWorkspacePreferences";
  tenantId: string; // UUID, Pflicht
  preferences: WorkspacePreferences; // Pflicht; auch {} zum Zurücksetzen erlaubt
}
```

`WorkspacePreferences` ist ein flaches Objekt. Es sind **nur** diese optionalen Schlüssel erlaubt:

| Schlüssel               | Typ und zulässige Werte                                      |
| ----------------------- | ------------------------------------------------------------ |
| `theme`                 | `"system" \| "light" \| "dark"`                              |
| `density`               | `"comfortable" \| "compact"`                                 |
| `landingPage`           | nichtleerer, gültiger String mit maximal 120 Unicode-Zeichen |
| `showKeyboardShortcuts` | `boolean`                                                    |

Das JSON muss ein Objekt sein und serialisiert maximal 4096 Bytes belegen. Arrays, weitere Schlüssel, `null` als Einstellungsobjekt, NUL-Zeichen und nicht wohlgeformte Strings sind ungültig.

**Erfolg `200`**

```ts
{
  data: {
    workspacePreferences: {
      preferences: WorkspacePreferences;
      updatedAt: string | null;
    }
  }
}
```

Die Einstellungen gehören immer der angemeldeten Person innerhalb des angegebenen Mandanten. Andere Mitglieder können sie weder lesen noch ändern.

### `listFollowUps`

**Feature:** `experience.workspace`

**Request**

```ts
{
  type: "listFollowUps";
  tenantId: string;          // UUID, Pflicht
  includeResolved?: boolean; // optional, Standard false
  limit?: number;            // optional, Ganzzahl 1..100, Standard 50
  ticketId?: string;         // optionale UUID; Filter auf ein lesbares Ticket
}
```

Wenn `ticketId` gesetzt ist, muss dieses Ticket im Mandanten für die anfragende Person lesbar sein. Ein unbekanntes oder nicht lesbares Ticket wird absichtlich gleich behandelt.

**Erfolg `200`**

```ts
{
  data: {
    followUps: Array<{
      id: string;
      ticketId: string | null;
      title: string;
      description: string | null;
      dueAt: string | null;
      priority: "low" | "normal" | "high";
      resolvedAt: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
    truncated: boolean;
  }
}
```

Die Liste enthält immer nur Wiedervorlagen der angemeldeten Person. Ohne `includeResolved: true` enthält sie nur offene Wiedervorlagen. `truncated: true` signalisiert, dass mindestens ein weiterer passender Eintrag existiert.

### `saveFollowUp`

**Feature:** `experience.workspace`

**Request**

```ts
{
  type: "saveFollowUp";
  tenantId: string; // UUID, Pflicht
  followUpId?: string; // UUID, optional: setzt einen bestehenden eigenen offenen Eintrag fort
  title: string; // Pflicht, getrimmt, 1..240 Unicode-Zeichen
  description: string | null; // Pflicht, null oder getrimmt 1..5000 Unicode-Zeichen
  dueAt: string | null; // Pflicht, null oder exakter ISO-8601-UTC-String, z. B. 2026-10-18T12:30:00.000Z
  priority: "low" | "normal" | "high"; // Pflicht
  ticketId: string | null; // Pflicht, null oder UUID eines lesbaren Tickets desselben Mandanten
}
```

**Erfolg beim Erstellen `201`; beim Ändern `200`**

```ts
{
  data: {
    followUp: {
      id: string;
      ticketId: string | null;
      title: string;
      description: string | null;
      dueAt: string | null;
      priority: "low" | "normal" | "high";
      resolvedAt: string | null;
      createdAt: string;
      updatedAt: string;
    }
  }
}
```

Die `owner_id` wird ausschliesslich aus der Anmeldung gesetzt. Eine Wiedervorlage kann an ein Ticket desselben Mandanten gebunden werden, ändert das Ticket aber nie.

| HTTP | Code                             | Bedeutung                                                             |
| ---: | -------------------------------- | --------------------------------------------------------------------- |
|  404 | `ticket_not_available`           | Das angegebene Ticket existiert nicht oder ist nicht lesbar.          |
|  404 | `follow_up_not_found`            | Der Eintrag existiert nicht oder gehört nicht der anmeldenden Person. |
|  409 | `follow_up_already_resolved`     | Ein erledigtes Follow-up ist nicht mehr änderbar.                     |
|  409 | `follow_up_changed_concurrently` | Der Eintrag wurde zwischen Lesen und Schreiben geändert.              |

### `resolveFollowUp`

**Feature:** `experience.workspace`

**Request**

```ts
{
  type: "resolveFollowUp";
  tenantId: string; // UUID, Pflicht
  followUpId: string; // UUID, Pflicht
}
```

**Erfolg `200`**

```ts
{
  data: {
    followUp: {
      id: string;
      ticketId: string | null;
      title: string;
      description: string | null;
      dueAt: string | null;
      priority: "low" | "normal" | "high";
      resolvedAt: string | null;
      createdAt: string;
      updatedAt: string;
    }
    changed: boolean;
  }
}
```

Der Aufruf ist idempotent: Bei einer bereits erledigten eigenen Wiedervorlage ist `changed: false`; andernfalls wird sie genau einmal mit der anmeldenden Person als Erledigerin/Erlediger markiert. Es gibt keine Löschaktion.

### `listServiceCatalog`

**Feature:** `portal.self-service`

**Request**

```ts
{
  type: "listServiceCatalog";
  tenantId: string; // UUID, Pflicht
}
```

**Erfolg `200`**

```ts
{
  data: {
    services: Array<{
      id: string;
      name: string;
      description: string | null;
      criticality: "low" | "medium" | "high" | "critical";
    }>;
  }
}
```

Es werden höchstens 500 aktive Services des eigenen Mandanten, alphabetisch nach `name`, geliefert. Aktive Mitgliedschaft genügt; es ist keine `asset.manage`-Berechtigung erforderlich.

### `confirmResolution`

**Feature:** `portal.self-service`

**Request**

```ts
{
  type: "confirmResolution";
  tenantId: string; // UUID, Pflicht
  ticketId: string; // UUID, Pflicht
  confirmed: boolean; // Pflicht; true = bestätigt, false = abgelehnt
  comment: string | null; // Pflicht; null oder getrimmt 1..3000 Unicode-Zeichen
}
```

**Erfolg `201`**

```ts
{
  data: {
    confirmation: {
      id: string;
      ticketId: string;
      confirmed: boolean;
      confirmedAt: string;
    }
  }
}
```

Nur die **anfragende** oder **betroffene** Person des Tickets darf bestätigen oder ablehnen. Das Ticket muss bereits `resolvedAt` haben. Der Aufruf speichert ausschliesslich die Bestätigung/Ablehnung und den optionalen Kommentar in einem neuen, unveränderlichen Datensatz. Er ändert **nie** Ticketstatus, Lösungszeitpunkt, Zuweisung oder Ticketinhalt.

| HTTP | Code                                  | Bedeutung                                      |
| ---: | ------------------------------------- | ---------------------------------------------- |
|  403 | `resolution_confirmation_not_allowed` | Die Person ist weder anfragend noch betroffen. |
|  404 | `ticket_not_available`                | Ticket existiert nicht oder ist nicht lesbar.  |
|  422 | `ticket_not_resolved`                 | Das Ticket hat noch keinen Lösungszeitpunkt.   |

### `listResolutionConfirmations`

**Feature:** `portal.self-service`

**Request**

```ts
{
  type: "listResolutionConfirmations";
  tenantId: string; // UUID, Pflicht
  ticketId: string; // UUID, Pflicht
}
```

**Erfolg `200`**

```ts
{
  data: {
    confirmations: Array<{
      id: string;
      ticketId: string;
      confirmed: boolean;
      comment: string | null;
      confirmedAt: string;
      confirmedByDisplayName: string | null;
    }>;
  }
}
```

Die Einträge sind absteigend nach `confirmedAt` sortiert und auf 100 begrenzt. Zugelassen sind:

1. die anfragende Person;
2. die betroffene Person;
3. eine zugewiesene Agentin/ein zugewiesener Agent mit `ticket.read.assigned`; oder
4. eine Agentin/ein Agent mit `ticket.read.department` für die Ticketabteilung.

Die Antwort enthält **nie** fremde Benutzer-ID, E-Mail-Adresse, Rollen, Mitgliedschaft oder sonstige Profildaten. Ausserhalb der Bestätigungsdaten wird nur der Anzeigename über `confirmedByDisplayName` ausgegeben.

| HTTP | Code                                  | Bedeutung                                          |
| ---: | ------------------------------------- | -------------------------------------------------- |
|  403 | `resolution_confirmation_not_allowed` | Keine der oben genannten Berechtigungen liegt vor. |
|  404 | `ticket_not_available`                | Ticket existiert nicht oder ist nicht lesbar.      |

---

# `ai-assist`

## Governance und Sicherheitsmodell

`ai-assist` ruft **keinen externen KI-Provider** auf. Die Function validiert und reiht lediglich einen vorbereiteten Entwurfsauftrag ein. Weder Eingabetext, Prompt, Vervollständigung, Provider-Geheimnis noch Endpoint werden in der Datenbank, im Audit oder in der Response gespeichert.

Vor **jeder** Aktion werden geprüft:

1. aktive Mandantenmitgliedschaft;
2. Feature-Schlüssel `ai.assist` (standardmässig deaktiviert);
3. aktive Approval-Zeile für Provider `nextdesk-managed`;
4. Freigabe des gewünschten Zwecks, Gültigkeit und die Mandantenlimits.

Die Approval-Zeile ist nur für Mandantenadministratoren mit `tenant.settings.manage` sowie aktuelle MFA-verifizierte Plattformadministratoren direkt lesbar. Browser erhalten keine direkten Schreibrechte auf Approvals oder Queue-Metadaten. Die atomare Datenbank-RPC ist nur für `service_role` verfügbar.

| HTTP | Code                        | Bedeutung                                                                                                   |
| ---: | --------------------------- | ----------------------------------------------------------------------------------------------------------- |
|  403 | `ai_feature_disabled`       | `ai.assist` ist nicht aktiv oder nicht wirksam.                                                             |
|  403 | `ai_provider_not_approved`  | Keine aktuell gültige Providerfreigabe erlaubt die Aktion.                                                  |
|  403 | `ai_purpose_not_approved`   | Der angefragte Zweck steht nicht in der Mandantenfreigabe.                                                  |
|  404 | `ai_object_not_available`   | Das referenzierte Ticket oder der Wissensartikel ist nicht im Mandanten verfügbar.                          |
|  429 | `ai_budget_exceeded`        | Pro-Request- oder atomar geprüfte Stundenlimite wurden erreicht.                                            |
|  503 | `ai_governance_unavailable` | Freigabe, Datenbankschema oder Governance-Prüfung ist nicht zuverlässig verfügbar; Zugriff bleibt gesperrt. |

## Aktionen

### `getCapabilities`

**Request**

```ts
{
  type: "getCapabilities";
  tenantId: string; // UUID, Pflicht
}
```

**Erfolg `200`**

```ts
{
  data: {
    draftRequestsEnabled: true;
    providerInvocation: false;
    purposes: Array<
      "general_draft" | "ticket_reply_draft" | "knowledge_article_draft"
    >;
    limits: {
      maxInputCharacters: 1200;
      maxOutputTokens: number;
      maxCostCents: number;
      maxRequestsPerHour: number;
    }
  }
}
```

`purposes` enthält nur die aktuell mandantenseitig freigegebenen Zwecke. `maxOutputTokens` ist das Minimum aus dem fixen Service-Limit `1024` und der Mandantenfreigabe; `maxCostCents` analog das Minimum aus `50` und der Freigabe. Die UI darf für eine deaktivierte/fehlende Governance nicht raten, sondern behandelt den entsprechenden Fehler als deaktivierte Funktion.

### `createDraftRequest`

**Request**

```ts
{
  type: "createDraftRequest";
  tenantId: string; // UUID, Pflicht
  purpose: "general_draft" | "ticket_reply_draft" | "knowledge_article_draft";
  object:
    | { type: "none"; id: null }
    | { type: "ticket"; id: string } // UUID
    | { type: "knowledge_article"; id: string }; // UUID
  input: string; // Pflicht, nur zur In-Memory-Validierung und Zeichenzählung
  maxOutputTokens: number; // Pflicht, sichere Ganzzahl 16..1024
  maxCostCents: number; // Pflicht, sichere Ganzzahl 1..50
}
```

Die Kombination von `purpose` und `object` ist zwingend:

| `purpose`                 | erlaubtes `object`                            |
| ------------------------- | --------------------------------------------- |
| `general_draft`           | `{ type: "none", id: null }`                  |
| `ticket_reply_draft`      | `{ type: "ticket", id: "<UUID>" }`            |
| `knowledge_article_draft` | `{ type: "knowledge_article", id: "<UUID>" }` |

`input` wird vor der Zeichenzählung NFC-normalisiert, Zeilenenden normalisiert, problematische Steuer-/Bidi-Zeichen entfernt und getrimmt. Danach muss es 1 bis 1200 Unicode-Zeichen umfassen. Nicht wohlgeformte Strings, NUL-Zeichen und Geheimnis-ähnliche Inhalte (zum Beispiel Bearer-Token, API-Key-Zuweisung oder Private-Key-Block) werden als `400 invalid_request` abgewiesen. Der bereinigte Text bleibt ausschliesslich im Arbeitsspeicher und wird nicht zurückgegeben.

**Erfolg `201`**

```ts
{
  data: {
    requestId: string; // UUID der Metadaten-Anfrage
    state: "prepared";
    providerInvocation: false;
  }
}
```

Die gespeicherten Metadaten beschränken sich auf Zweck, Objekttyp/-ID, Eingabezeichenanzahl, Zeitstempel, Akteur sowie beantragte Token-/Kostenobergrenzen. Es gibt keinen automatischen Provideraufruf und keine automatische Ticketänderung.
