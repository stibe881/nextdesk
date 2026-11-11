<#
  Installiert den nextDesk IPAM-Agenten als Windows-Dienst (WinSW).

  Voraussetzungen: Node.js 22 LTS (x64) unter C:\Program Files\nodejs,
  WinSW-x64.exe heruntergeladen (https://github.com/winsw/winsw/releases).
  Ausführen in einer PowerShell als Administrator im Ordner tools\ipam-agent:

    .\windows\install-service.ps1 -WinSW C:\Temp\WinSW-x64.exe [-ServiceAccount 'DOMAIN\gmsa-ndipam$']
#>
param(
  [Parameter(Mandatory = $true)][string]$WinSW,
  [string]$ServiceAccount = ''
)
$ErrorActionPreference = 'Stop'

$source = Split-Path -Parent $PSScriptRoot
$target = Join-Path $env:ProgramFiles 'nextDesk\ipam-agent'
$data = Join-Path $env:ProgramData 'nextDesk\ipam-agent'
$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'

if (-not (Test-Path $node)) { throw "Node.js nicht gefunden: $node" }
if (-not (Test-Path (Join-Path $source 'dist\main.js'))) {
  throw 'dist\main.js fehlt. Zuerst «npm ci» und «npm run build» ausführen.'
}

New-Item -ItemType Directory -Force -Path $target, $data, (Join-Path $data 'logs') | Out-Null
Copy-Item -Recurse -Force (Join-Path $source 'dist'), (Join-Path $source 'node_modules'), (Join-Path $source 'package.json') $target
Copy-Item -Force $WinSW (Join-Path $target 'nextdesk-ipam-agent.exe')
$xml = Get-Content (Join-Path $PSScriptRoot 'nextdesk-ipam-agent.xml') -Raw
if ($ServiceAccount) {
  $xml = $xml.Replace('</service>', "  <serviceaccount>`n    <username>$ServiceAccount</username>`n    <allowservicelogon>true</allowservicelogon>`n  </serviceaccount>`n</service>")
}
Set-Content -Path (Join-Path $target 'nextdesk-ipam-agent.xml') -Value $xml -Encoding UTF8

$config = Join-Path $data 'config.json'
if (-not (Test-Path $config)) {
  Copy-Item (Join-Path $source 'config.example.json') $config
  Write-Host "Bitte $config ausfüllen (nextdeskUrl, agentToken, SNMP-Zugangsdaten)."
}
# Konfiguration enthält Geheimnisse: nur SYSTEM, Administratoren und das Dienstkonto.
$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
foreach ($identity in @('NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators') + @($(if ($ServiceAccount) { $ServiceAccount }))) {
  if (-not $identity) { continue }
  $rights = if ($identity -eq $ServiceAccount) { 'Read' } else { 'FullControl' }
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($identity, $rights, 'Allow')))
}
Set-Acl -Path $config -AclObject $acl

& (Join-Path $target 'nextdesk-ipam-agent.exe') install
Write-Host 'Dienst installiert. Test: node "C:\Program Files\nextDesk\ipam-agent\dist\main.js" --check'
Write-Host 'Start: Start-Service nextdesk-ipam-agent'
