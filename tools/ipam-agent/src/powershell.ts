/**
 * Microsoft DHCP and DNS via PowerShell (Windows only; modules DhcpServer
 * and DnsServer from RSAT or the server roles).
 *
 * Parameters are never put into the script text: the script reads them as
 * JSON from the environment variable NEXTDESK_PARAMS, so values are data and
 * cannot inject commands.
 */

import { spawn } from "node:child_process";

export const SCRIPTS = {
  dhcpRead: String.raw`
$ErrorActionPreference = 'Stop'
$p = $env:NEXTDESK_PARAMS | ConvertFrom-Json
$server = [string]$p.server
$stats = @{}
foreach ($s in @(Get-DhcpServerv4ScopeStatistics -ComputerName $server)) { $stats[[string]$s.ScopeId] = $s }
$scopes = New-Object System.Collections.ArrayList
$leases = New-Object System.Collections.ArrayList
foreach ($scope in @(Get-DhcpServerv4Scope -ComputerName $server)) {
  $id = [string]$scope.ScopeId
  $st = $stats[$id]
  [void]$scopes.Add([pscustomobject]@{
    scopeId = $id; subnetMask = [string]$scope.SubnetMask; name = [string]$scope.Name
    description = [string]$scope.Description; state = [string]$scope.State
    startRange = [string]$scope.StartRange; endRange = [string]$scope.EndRange
    leaseDurationSeconds = [int]$scope.LeaseDuration.TotalSeconds
    inUse = $(if ($st) { [int]$st.InUse } else { $null })
    free = $(if ($st) { [int]$st.Free } else { $null })
    reserved = $(if ($st) { [int]$st.Reserved } else { $null })
  })
  foreach ($l in @(Get-DhcpServerv4Lease -ComputerName $server -ScopeId $scope.ScopeId)) {
    $state = [string]$l.AddressState
    [void]$leases.Add([pscustomobject]@{
      scopeId = $id; address = [string]$l.IPAddress; clientId = [string]$l.ClientId
      hostname = [string]$l.HostName; state = $state
      expiresAt = $(if ($l.LeaseExpiryTime) { $l.LeaseExpiryTime.ToUniversalTime().ToString('o') } else { $null })
      reservation = $state -like '*Reservation*'
      reservationName = $(if ($state -like '*Reservation*') { [string]$l.HostName } else { $null })
    })
  }
}
[pscustomobject]@{ scopes = $scopes; leases = $leases } | ConvertTo-Json -Depth 4 -Compress
`,
  dnsRead: String.raw`
$ErrorActionPreference = 'Stop'
$p = $env:NEXTDESK_PARAMS | ConvertFrom-Json
$server = [string]$p.server
$wanted = @($p.zones | ForEach-Object { ([string]$_).ToLowerInvariant() })
$result = New-Object System.Collections.ArrayList
$zones = @(Get-DnsServerZone -ComputerName $server | Where-Object {
  -not $_.IsAutoCreated -and $_.ZoneType -eq 'Primary' -and $_.ZoneName -ne 'TrustAnchors'
})
foreach ($zone in $zones) {
  $name = ([string]$zone.ZoneName).ToLowerInvariant()
  if ($wanted.Count -gt 0 -and -not ($wanted -contains $name)) { continue }
  $records = New-Object System.Collections.ArrayList
  foreach ($type in @('A', 'AAAA', 'PTR', 'CNAME')) {
    foreach ($r in @(Get-DnsServerResourceRecord -ComputerName $server -ZoneName $zone.ZoneName -RRType $type -ErrorAction SilentlyContinue)) {
      $value = switch ($type) {
        'A' { $r.RecordData.IPv4Address.IPAddressToString }
        'AAAA' { $r.RecordData.IPv6Address.IPAddressToString }
        'PTR' { $r.RecordData.PtrDomainName }
        'CNAME' { $r.RecordData.HostNameAlias }
      }
      [void]$records.Add([pscustomobject]@{ name = [string]$r.HostName; type = $type; value = [string]$value; ttl = [int]$r.TimeToLive.TotalSeconds })
    }
  }
  [void]$result.Add([pscustomobject]@{ zone = $name; records = $records })
}
ConvertTo-Json -InputObject @($result) -Depth 5 -Compress
`,
  dhcpReserve: String.raw`
$ErrorActionPreference = 'Stop'
$p = $env:NEXTDESK_PARAMS | ConvertFrom-Json
$clientId = ([string]$p.mac).Replace(':', '-')
$existing = Get-DhcpServerv4Reservation -ComputerName $p.server -ScopeId $p.scopeId -ErrorAction SilentlyContinue |
  Where-Object { [string]$_.IPAddress -eq [string]$p.address }
if ($existing) {
  if (([string]$existing.ClientId).ToLowerInvariant() -ne $clientId.ToLowerInvariant()) {
    throw "Für $($p.address) besteht bereits eine Reservierung mit $($existing.ClientId)."
  }
  [pscustomobject]@{ changed = $false } | ConvertTo-Json -Compress
  return
}
$splat = @{ ComputerName = $p.server; ScopeId = $p.scopeId; IPAddress = $p.address; ClientId = $clientId }
if ($p.name) { $splat.Name = [string]$p.name }
if ($p.description) { $splat.Description = [string]$p.description }
Add-DhcpServerv4Reservation @splat
[pscustomobject]@{ changed = $true } | ConvertTo-Json -Compress
`,
  dhcpRelease: String.raw`
$ErrorActionPreference = 'Stop'
$p = $env:NEXTDESK_PARAMS | ConvertFrom-Json
Remove-DhcpServerv4Reservation -ComputerName $p.server -IPAddress $p.address
[pscustomobject]@{ changed = $true } | ConvertTo-Json -Compress
`,
  dnsUpsertA: String.raw`
$ErrorActionPreference = 'Stop'
$p = $env:NEXTDESK_PARAMS | ConvertFrom-Json
$type = [string]$p.type
$existing = @(Get-DnsServerResourceRecord -ComputerName $p.server -ZoneName $p.zone -Name $p.name -RRType $type -ErrorAction SilentlyContinue)
$present = $false
foreach ($r in $existing) {
  $ip = if ($type -eq 'A') { $r.RecordData.IPv4Address.IPAddressToString } else { $r.RecordData.IPv6Address.IPAddressToString }
  if ($ip -eq $p.address) { $present = $true }
  elseif ($p.replace) { Remove-DnsServerResourceRecord -ComputerName $p.server -ZoneName $p.zone -InputObject $r -Force }
}
if (-not $present) {
  $splat = @{ ComputerName = $p.server; ZoneName = $p.zone; Name = $p.name }
  if ($p.ttl) { $splat.TimeToLive = [TimeSpan]::FromSeconds([int]$p.ttl) }
  if ($p.createPtr) { $splat.CreatePtr = $true }
  if ($type -eq 'A') { Add-DnsServerResourceRecordA @splat -IPv4Address $p.address }
  else { Add-DnsServerResourceRecordAAAA @splat -IPv6Address $p.address }
}
[pscustomobject]@{ changed = (-not $present) } | ConvertTo-Json -Compress
`,
  dnsUpsertPtr: String.raw`
$ErrorActionPreference = 'Stop'
$p = $env:NEXTDESK_PARAMS | ConvertFrom-Json
$target = ([string]$p.target).TrimEnd('.') + '.'
$existing = @(Get-DnsServerResourceRecord -ComputerName $p.server -ZoneName $p.zone -Name $p.name -RRType Ptr -ErrorAction SilentlyContinue)
$present = $false
foreach ($r in $existing) {
  if (([string]$r.RecordData.PtrDomainName).ToLowerInvariant() -eq $target.ToLowerInvariant()) { $present = $true }
  elseif ($p.replace) { Remove-DnsServerResourceRecord -ComputerName $p.server -ZoneName $p.zone -InputObject $r -Force }
}
if (-not $present) {
  $splat = @{ ComputerName = $p.server; ZoneName = $p.zone; Name = $p.name; PtrDomainName = $target }
  if ($p.ttl) { $splat.TimeToLive = [TimeSpan]::FromSeconds([int]$p.ttl) }
  Add-DnsServerResourceRecordPtr @splat
}
[pscustomobject]@{ changed = (-not $present) } | ConvertTo-Json -Compress
`,
  dnsDelete: String.raw`
$ErrorActionPreference = 'Stop'
$p = $env:NEXTDESK_PARAMS | ConvertFrom-Json
$removed = 0
foreach ($r in @(Get-DnsServerResourceRecord -ComputerName $p.server -ZoneName $p.zone -Name $p.name -RRType $p.type -ErrorAction SilentlyContinue)) {
  $value = switch ([string]$p.type) {
    'A' { $r.RecordData.IPv4Address.IPAddressToString }
    'AAAA' { $r.RecordData.IPv6Address.IPAddressToString }
    'PTR' { ([string]$r.RecordData.PtrDomainName).TrimEnd('.') }
    'CNAME' { ([string]$r.RecordData.HostNameAlias).TrimEnd('.') }
  }
  if (([string]$value).ToLowerInvariant() -eq ([string]$p.value).ToLowerInvariant()) {
    Remove-DnsServerResourceRecord -ComputerName $p.server -ZoneName $p.zone -InputObject $r -Force
    $removed++
  }
}
[pscustomobject]@{ removed = $removed } | ConvertTo-Json -Compress
`,
} as const;

export type ScriptName = keyof typeof SCRIPTS;

export class PowerShellError extends Error {}

/** Runs a script; parameters go through NEXTDESK_PARAMS as JSON. */
export function runPowerShell(
  executable: string,
  script: ScriptName,
  params: Record<string, unknown>,
  timeoutMs = 300_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodeScript(SCRIPTS[script]),
      ],
      {
        env: { ...process.env, NEXTDESK_PARAMS: JSON.stringify(params) },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new PowerShellError("PowerShell: Zeitüberschreitung"));
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new PowerShellError(`PowerShell nicht startbar: ${error.message}`),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(
          new PowerShellError(
            cleanError(stderr) || `PowerShell beendet mit Code ${code}`,
          ),
        );
      }
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
      try {
        resolve(line ? JSON.parse(line) : null);
      } catch {
        reject(new PowerShellError("PowerShell lieferte kein gültiges JSON."));
      }
    });
  });
}

/** -EncodedCommand expects Base64 of UTF-16LE. */
export function encodeScript(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/** First meaningful line of a PowerShell error (no stack, max 500 chars). */
export function cleanError(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.startsWith("+") &&
        !/^(At line|In Zeile|CategoryInfo|FullyQualifiedErrorId)/i.test(line),
    );
  return (lines[0] ?? "").slice(0, 500);
}
