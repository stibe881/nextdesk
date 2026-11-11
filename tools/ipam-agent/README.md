# nextDesk IPAM-Agent

Der Netzwerkagent läuft in Ihrem LAN und liefert der IP-Adressverwaltung von
nextDesk, was nextDesk aus der Cloud nicht sehen kann:

- **Ping-Sweep** der Subnetze (IPv4) und lokale **ARP/NDP-Tabelle**
- per **SNMP** (nur lesend) von Switches und Routern: ARP-Tabelle
  (IP ↔ MAC, auch IPv6-Nachbarn), **MAC-Tabelle** (Bridge/Q-Bridge) und
  **LLDP-Nachbarn** – daraus ermittelt nextDesk den Switch-Port je Gerät
- **Microsoft DHCP** (Bereiche, Auslastung, Leases, Reservierungen) und
  **Microsoft DNS** (A, AAAA, PTR, CNAME) per PowerShell – nur auf Windows

nextDesk vergleicht die Beobachtungen mit der Dokumentation und meldet Funde:
Ghost-IPs, IP-Konflikte, fremde MAC auf reservierten Adressen, DNS-Abweichungen,
Adressen ausserhalb aller Subnetze und lange nicht gesehene Adressen.
Auf Wunsch legt der Agent DHCP-Reservierungen und DNS-Records an – aber nur
für Aufträge, die eine berechtigte Person in nextDesk ausgelöst hat.

Der Agent verbindet sich **nur ausgehend per HTTPS (443)** mit nextDesk. Es
braucht keine eingehende Firewall-Regel.

## Voraussetzungen

| Was                 | Details                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VM oder Server      | 2 vCPU, 2 GB RAM, 1 GB Disk. Linux mit Docker **oder** Windows Server 2016+ (für DHCP/DNS zwingend Windows).                                                                        |
| Node.js             | 22 LTS (nur Windows-Installation; im Docker-Image enthalten)                                                                                                                        |
| Ausgehend           | HTTPS 443 zu `<projekt>.supabase.co` (nextDesk). Kein Proxy mit TLS-Aufbruch, sonst `NODE_EXTRA_CA_CERTS` setzen.                                                                   |
| ICMP                | Echo Request vom Agenten in alle Subnetze erlaubt (Firewalls, z. B. Sophos XGS, und IDS informieren, damit der Sweep nicht als Angriff gilt).                                       |
| SNMP                | UDP 161 vom Agenten zu den Switches/Routern. Am besten **SNMPv3 nur lesend** (authPriv, SHA-256/AES). Ältere HP ProCurve ggf. v2c mit Read-only-Community und ACL auf die Agent-IP. |
| LLDP                | Auf den Switches aktiv (Aruba AOS-CX/AOS-S: Standard). Ohne LLDP ermittelt nextDesk den Port aus der MAC-Tabelle.                                                                   |
| DHCP/DNS (optional) | Windows-Agent im Domänennetz, RSAT-Module `DhcpServer` und `DnsServer` (`Install-WindowsFeature RSAT-DHCP, RSAT-DNS-Server`), Dienstkonto siehe unten.                              |

### SNMPv3 auf Aruba einrichten (Beispiel)

Die genaue Syntax hängt von der Firmware ab; im Zweifel das Aruba-Handbuch
der eingesetzten Version prüfen.

AOS-CX (6300M, 6000):

```
snmp-server vrf default
snmpv3 user nextdesk-ro auth sha auth-pass plaintext <AuthSchlüssel> priv aes priv-pass plaintext <PrivSchlüssel>
```

AOS-S / ProCurve (2930F):

```
snmpv3 enable
snmpv3 user nextdesk-ro auth sha <AuthSchlüssel> priv aes <PrivSchlüssel>
snmpv3 group operatorauth user nextdesk-ro sec-model ver3
snmpv3 only
```

Die Schlüssel tragen Sie **nur** in die lokale `config.json` des Agenten ein –
in nextDesk stehen lediglich Gerätename, SNMP-Version und Benutzername.

## Installation

### 1. Agent in nextDesk anlegen

IP-Adressen → Discovery → **Agenten** → «Agent anlegen». nextDesk zeigt den
Token **einmal** an – kopieren und sicher aufbewahren. Dort legen Sie auch
fest, welche Subnetze gescannt werden, den Zeitplan, die SNMP-Ziele und die
DHCP/DNS-Server.

### 2a. Linux mit Docker

```bash
sudo mkdir -p /etc/nextdesk-ipam-agent
sudo cp tools/ipam-agent/config.example.json /etc/nextdesk-ipam-agent/config.json
sudo chmod 600 /etc/nextdesk-ipam-agent/config.json && sudo chown 1000:1000 /etc/nextdesk-ipam-agent/config.json
sudo nano /etc/nextdesk-ipam-agent/config.json     # URL, Token, SNMP-Zugangsdaten

docker build -t nextdesk-ipam-agent tools/ipam-agent
docker run --rm --network host -v /etc/nextdesk-ipam-agent:/etc/nextdesk-ipam-agent:ro \
  nextdesk-ipam-agent node dist/main.js --check      # Verbindung prüfen
docker run -d --name nextdesk-ipam-agent --network host --restart unless-stopped \
  -v /etc/nextdesk-ipam-agent:/etc/nextdesk-ipam-agent:ro nextdesk-ipam-agent
docker logs -f nextdesk-ipam-agent
```

`--network host` ist nötig, damit Ping, ARP/NDP und SNMP die echten Netze sehen.

### 2b. Windows-Dienst

1. Node.js 22 LTS (x64) installieren.
2. Ordner `tools/ipam-agent` auf den Server kopieren, dort:
   ```powershell
   npm ci
   npm run build
   ```
3. [WinSW](https://github.com/winsw/winsw/releases) (`WinSW-x64.exe`) herunterladen und als Administrator:
   ```powershell
   .\windows\install-service.ps1 -WinSW C:\Temp\WinSW-x64.exe -ServiceAccount 'DOMAIN\gmsa-ndipam$'
   ```
   Das Skript kopiert den Agenten nach `C:\Program Files\nextDesk\ipam-agent`,
   legt `C:\ProgramData\nextDesk\ipam-agent\config.json` an (Rechte nur für
   SYSTEM, Administratoren und das Dienstkonto) und installiert den Dienst
   «nextDesk IPAM-Agent».
4. `config.json` ausfüllen, testen und starten:
   ```powershell
   node "C:\Program Files\nextDesk\ipam-agent\dist\main.js" --check
   Start-Service nextdesk-ipam-agent
   ```
   Protokolle: `C:\ProgramData\nextDesk\ipam-agent\logs`.

Alternativ zu WinSW geht jeder Dienst-Wrapper (z. B. NSSM). `sc.exe create`
allein genügt nicht, weil Node.js kein Windows-Dienstprogramm ist.

## Konfiguration (`config.json`)

| Feld                        | Bedeutung                                                                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nextdeskUrl`               | `https://<projekt>.supabase.co/functions/v1/ipam-agent`                                                                                                                                        |
| `agentToken`                | Token aus nextDesk (`ndip_…`). Alternativ Umgebungsvariable `NEXTDESK_AGENT_TOKEN`.                                                                                                            |
| `snmp.default`              | Zugangsdaten für alle SNMP-Ziele: `version` `v3` mit `user`, `authProtocol` (`sha256`, `sha`, …), `authKey`, `privProtocol` (`aes`, `aes256b`, `des`), `privKey` – oder `v2c` mit `community`. |
| `snmp.hosts`                | Abweichende Zugangsdaten je Ziel (Schlüssel = Hostname/IP wie in nextDesk).                                                                                                                    |
| `scan.subnets`              | Optional: eigene Subnetzliste statt der Subnetze aus nextDesk (z. B. `["10.20.30.0/24"]`).                                                                                                     |
| `scan.reverseDns`           | Hostnamen der antwortenden Adressen per PTR auflösen (Standard: ja).                                                                                                                           |
| `scan.maxHostsPerRun`       | Obergrenze für den Ping-Sweep pro Durchlauf (Standard 65536).                                                                                                                                  |
| `dhcpServers`, `dnsServers` | Optional: eigene Serverliste statt der aus nextDesk.                                                                                                                                           |
| `allowWrites`               | `true` erlaubt DHCP-Reservierungen und DNS-Änderungen. Zusätzlich muss in nextDesk «Änderungen an DHCP/DNS erlauben» aktiv sein. Standard: `false`.                                            |
| `ouiFile`                   | Optional: Pfad zur IEEE-Liste (`oui.txt` oder `oui.csv` von standards-oui.ieee.org) für vollständige Herstellernamen.                                                                          |
| `logLevel`                  | `debug`, `info`, `warn`, `error`                                                                                                                                                               |

Zeitplan, Subnetze, SNMP-Ziele und DHCP/DNS-Server stellen Sie in nextDesk
ein; der Agent holt sie bei jedem Kontakt (etwa jede Minute) neu.

Ablauf: Anmeldung (`hello`) → Aufträge ausführen → Scan nach Zeitplan →
Ergebnisse in Teilen melden (`report`) → Ergebnis von Aufträgen melden
(`jobResult`). «Jetzt scannen» in nextDesk startet einen Scan beim nächsten
Kontakt.

## Rechte des Dienstkontos (DHCP/DNS)

| Aufgabe                               | Benötigte Rechte                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Discovery (Ping, ARP, SNMP)           | keine besonderen Rechte (`LocalService` genügt)                                                                              |
| DHCP lesen                            | Mitglied von **DHCP Users** auf den DHCP-Servern                                                                             |
| DNS lesen                             | Leserechte auf die Zonen (z. B. Gruppe **DnsAdmins** nur falls nötig; besser delegierte Leserechte auf `MicrosoftDNS` im AD) |
| DHCP-Reservierungen anlegen/entfernen | **DHCP Administrators** – nur wenn nextDesk schreiben soll                                                                   |
| DNS-Records anlegen/ändern            | delegierte Schreibrechte auf die betroffenen Zonen oder **DnsAdmins** – nur wenn nextDesk schreiben soll                     |

Empfehlung: zuerst nur lesen und die Abweichungen prüfen; Schreiben später
pro Server freigeben. Am besten ein Group Managed Service Account (gMSA).

## Sicherheitshinweise

- **Nur ausgehend:** Der Agent öffnet keinen Port. Er spricht ausschliesslich
  HTTPS mit der Edge Function `ipam-agent`.
- **Token:** wird in nextDesk nur als SHA-256-Hash gespeichert und konstant-
  zeitlich verglichen. Bei Verdacht in nextDesk «Token erneuern» oder
  «Widerrufen» – der alte Token ist sofort ungültig. Anfragen sind pro Agent
  begrenzt (120 pro Minute).
- **Zugangsdaten bleiben lokal:** SNMP-Schlüssel und das Dienstkonto verlassen
  den Server nie. `config.json` nur für Administratoren und das Dienstkonto
  lesbar machen (Linux `chmod 600`, Windows erledigt das Installationsskript).
  nextDesk lehnt Konfigurationen mit Feldern wie `community` oder `authKey` ab.
- **Nur lesend per SNMP:** Der Agent führt nur GET/GETBULK aus. Verwenden Sie
  einen Read-only-Benutzer bzw. eine Read-only-Community mit ACL.
- **Schreiben nur mit doppelter Freigabe:** DHCP/DNS-Aufträge führt der Agent
  nur aus, wenn `allowWrites` lokal **und** in nextDesk aktiv ist, der Server
  konfiguriert ist und der Auftrag von einer Person mit «IP-Adressen verwalten»
  freigegeben wurde. Alle Werte werden vor dem Aufruf erneut geprüft und als
  Daten (JSON) an PowerShell übergeben, nie als Skripttext.
- **Netzwerklast:** Der Ping-Sweep sendet ein Echo pro Adresse (Standard 64
  parallel, 1 s Timeout). IDS/IPS informieren, Zeitplan nicht unter 15 Minuten.

## Entwicklung

```bash
cd tools/ipam-agent
npm ci
npm test          # Parser-Tests (node:test)
npm run typecheck
npm run build && node dist/main.js --config ./config.json --once
```

Der Agent gehört nicht zum pnpm-Workspace; er hat ein eigenes
`package-lock.json` und nur eine Laufzeitabhängigkeit (`net-snmp`).
