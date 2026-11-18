# IPAM-API – Beispiele

Kurze Beispiele für die REST-API der IP-Adressverwaltung. Die vollständige
Beschreibung steht in [`ipam-api.openapi.yaml`](ipam-api.openapi.yaml).

- Basisadresse: `https://<projekt>.supabase.co/functions/v1/ipam-api`
- Schlüssel: Einstellungen → IP-Adressverwaltung → REST-API → «Schlüssel
  erstellen». Für Reservierungen «Schreiben erlauben» wählen. Der Schlüssel
  wird nur einmal angezeigt – im Tresor des Werkzeugs ablegen (Ansible Vault,
  Terraform-Variable mit `sensitive = true`, Power-Automate-Umgebungsvariable
  vom Typ «Geheimnis»), nie im Klartext ins Repository.
- Header: `Authorization: Bearer ndk_ipam_…`
- Grenzen: 120 Anfragen pro Minute und Schlüssel, Antwort `429` mit
  `Retry-After`.

Die IDs und Adressen unten sind Beispiele.

## curl

```bash
export NEXTDESK_IPAM_URL="https://<projekt>.supabase.co/functions/v1/ipam-api"
export NEXTDESK_IPAM_KEY="ndk_ipam_…"

# Subnetze
curl -s -H "Authorization: Bearer $NEXTDESK_IPAM_KEY" "$NEXTDESK_IPAM_URL/prefixes?limit=50"

# Nächste freie IP im Subnetz reservieren
curl -s -X POST -H "Authorization: Bearer $NEXTDESK_IPAM_KEY" -H "Content-Type: application/json" \
  -d '{"hostname":"PC-A2-010","mac":"aa:bb:cc:dd:ee:10","description":"Laborgerät"}' \
  "$NEXTDESK_IPAM_URL/prefixes/4f1c2b3a-1111-4222-8333-444455556666/next-address"

# Adresse ändern und freigeben
curl -s -X PATCH -H "Authorization: Bearer $NEXTDESK_IPAM_KEY" -H "Content-Type: application/json" \
  -d '{"description":"umgezogen nach Haus B"}' "$NEXTDESK_IPAM_URL/addresses/10.20.67.12"
curl -s -X DELETE -H "Authorization: Bearer $NEXTDESK_IPAM_KEY" "$NEXTDESK_IPAM_URL/addresses/10.20.67.12"

# Suche (IP, MAC, Hostname, VLAN-Nummer)
curl -s -H "Authorization: Bearer $NEXTDESK_IPAM_KEY" "$NEXTDESK_IPAM_URL/search?q=DRU-A2-KOPIE"
```

## Ansible (`ansible.builtin.uri`)

```yaml
- name: Feste IP für einen neuen Server aus nextDesk holen
  hosts: localhost
  gather_facts: false
  vars:
    nextdesk_ipam_url: "https://<projekt>.supabase.co/functions/v1/ipam-api"
    # in Ansible Vault ablegen: ansible-vault encrypt_string 'ndk_ipam_…' --name nextdesk_ipam_key
    server_prefix_id: "4f1c2b3a-1111-4222-8333-444455556666"
    new_hostname: "SRV-APP-07"
  tasks:
    - name: Nächste freie Adresse reservieren
      ansible.builtin.uri:
        url: "{{ nextdesk_ipam_url }}/prefixes/{{ server_prefix_id }}/next-address"
        method: POST
        headers:
          Authorization: "Bearer {{ nextdesk_ipam_key }}"
        body_format: json
        body:
          hostname: "{{ new_hostname }}"
          description: "Bereitgestellt mit Ansible"
        status_code: 201
      register: reservation

    - name: Adresse verwenden
      ansible.builtin.debug:
        msg: "{{ new_hostname }} erhält {{ reservation.json.data.address }}"

    # Beim Rückbau wieder freigeben
    - name: Adresse freigeben
      ansible.builtin.uri:
        url: "{{ nextdesk_ipam_url }}/addresses/{{ reservation.json.data.address }}"
        method: DELETE
        headers:
          Authorization: "Bearer {{ nextdesk_ipam_key }}"
        status_code: 200
      when: decommission | default(false) | bool
```

## Terraform

### Lesen mit dem `http`-Provider

```hcl
variable "nextdesk_ipam_key" {
  type      = string
  sensitive = true
}

locals {
  ipam_url = "https://<projekt>.supabase.co/functions/v1/ipam-api"
}

data "http" "drucker_vlan" {
  url = "${local.ipam_url}/search?q=67"
  request_headers = {
    Authorization = "Bearer ${var.nextdesk_ipam_key}"
  }
}

output "vlans" {
  value = jsondecode(data.http.drucker_vlan.response_body).data.vlans
}
```

### Reservieren und freigeben mit dem Provider `Mastercard/restapi`

```hcl
terraform {
  required_providers {
    restapi = {
      source  = "Mastercard/restapi"
      version = "~> 1.19"
    }
  }
}

provider "restapi" {
  uri                  = "https://<projekt>.supabase.co/functions/v1/ipam-api"
  write_returns_object = true
  id_attribute         = "data/address"
  headers = {
    Authorization = "Bearer ${var.nextdesk_ipam_key}"
    Content-Type  = "application/json"
  }
}

# POST /prefixes/<id>/next-address reserviert, DELETE /addresses/<ip> gibt frei.
resource "restapi_object" "vm_ip" {
  path           = "/prefixes/4f1c2b3a-1111-4222-8333-444455556666/next-address"
  create_method  = "POST"
  read_path      = "/addresses/{id}"
  update_path    = "/addresses/{id}"
  update_method  = "PATCH"
  destroy_path   = "/addresses/{id}"
  destroy_method = "DELETE"
  data = jsonencode({
    hostname    = "VM-WEB-03"
    description = "Terraform"
  })
}

output "vm_ip" {
  value = jsondecode(restapi_object.vm_ip.api_response).data.address
}
```

## Power Automate (Aktion «HTTP»)

1. Aktion **HTTP** hinzufügen.
2. **Methode** `POST`, **URI**
   `https://<projekt>.supabase.co/functions/v1/ipam-api/prefixes/<Subnetz-ID>/next-address`
3. **Header**: `Authorization` = `Bearer @{parameters('nextDesk IPAM-Schlüssel')}`
   (Umgebungsvariable vom Typ «Geheimnis»), `Content-Type` = `application/json`
4. **Text**:

   ```json
   {
     "hostname": "@{triggerBody()?['Geraetename']}",
     "description": "Angefordert über Formular von @{triggerBody()?['Antragsteller']}"
   }
   ```

5. Danach **JSON analysieren** mit dem Schema aus der OpenAPI-Beschreibung
   (`Address`) und `body('JSON_analysieren')?['data']?['address']` in
   E-Mail oder Teams-Nachricht verwenden.
6. Unter **Einstellungen** der HTTP-Aktion die Wiederholungsrichtlinie auf
   «Exponentiell» stellen; bei `429` wartet Power Automate dann den
   `Retry-After`-Wert ab.

### Webhooks in Power Automate empfangen

Trigger **«Beim Empfang einer HTTP-Anforderung»** anlegen und dessen URL in
nextDesk als Webhook eintragen (Ereignisse z. B. «Adresse reserviert»). Den
Header `X-NextDesk-Event` für Verzweigungen nutzen.

## Webhook-Signatur prüfen

Jede Zustellung trägt `X-NextDesk-Signature: t=<Unix-Zeit>,v1=<hex>`. Die
Signatur ist HMAC-SHA256 über `"<t>.<roher Body>"` mit dem Signatur-Geheimnis
(`whsec_…`), das beim Anlegen des Webhooks einmal angezeigt wird.

```python
import hashlib, hmac, time

def verify(secret: str, header: str, body: bytes, tolerance: int = 300) -> bool:
    parts = dict(item.split("=", 1) for item in header.split(","))
    timestamp, signature = int(parts["t"]), parts["v1"]
    if abs(time.time() - timestamp) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

```javascript
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret, header, rawBody, tolerance = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > tolerance) return false;
  const expected = createHmac("sha256", secret)
    .update(`${parts.t}.${rawBody}`)
    .digest("hex");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}
```
