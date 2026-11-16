<#
  Installiert oder aktualisiert den nextDesk IPAM-Agenten (Sonde der
  Überwachung) als Windows-Dienst (WinSW).

  Voraussetzung: Node.js 22 LTS (x64) unter C:\Program Files\nodejs.

  Aus dem Installationspaket (nextDesk → Sonde herunterladen): die
  heruntergeladene config.json in den entpackten Ordner «nextdesk-sonde»
  legen und in einer PowerShell als Administrator ausführen:

    .\windows\install-service.ps1 [-ServiceAccount 'DOMAIN\gmsa-ndipam$']

  WinSW liegt dem Paket bei. Aus dem Repository (tools\ipam-agent, nach
  «npm ci» und «npm run build») zusätzlich -WinSW <Pfad zu WinSW-x64.exe>.

  Ein erneuter Aufruf mit einem neueren Paket aktualisiert den Agenten; die
  installierte config.json bleibt erhalten, wenn im Paketordner keine liegt.
#>
param(
  [string]$WinSW = '',
  [string]$ServiceAccount = ''
)
$ErrorActionPreference = 'Stop'

$source = Split-Path -Parent $PSScriptRoot
$target = Join-Path $env:ProgramFiles 'nextDesk\ipam-agent'
$data = Join-Path $env:ProgramData 'nextDesk\ipam-agent'
$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'

$serviceName = 'nextdesk-ipam-agent'
if (-not $WinSW) { $WinSW = Join-Path $PSScriptRoot 'WinSW-x64.exe' }

if (-not (Test-Path $node)) { throw "Node.js nicht gefunden: $node (Node.js 22 LTS x64 installieren)" }
if (-not (Test-Path $WinSW)) { throw "WinSW nicht gefunden: $WinSW (Parameter -WinSW angeben)" }
if (-not (Test-Path (Join-Path $source 'dist\main.js'))) {
  throw 'dist\main.js fehlt. Zuerst «npm ci» und «npm run build» ausführen.'
}

$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing -and $existing.Status -ne 'Stopped') {
  Stop-Service -Name $serviceName -Force
  $existing.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
}

New-Item -ItemType Directory -Force -Path $target, $data, (Join-Path $data 'logs') | Out-Null
# Alte Programmdateien entfernen, damit keine gelöschten Module zurückbleiben.
foreach ($old in 'dist', 'node_modules') {
  $path = Join-Path $target $old
  if (Test-Path $path) { Remove-Item -Recurse -Force $path }
}
Copy-Item -Recurse -Force (Join-Path $source 'dist'), (Join-Path $source 'node_modules'), (Join-Path $source 'package.json') $target
Copy-Item -Force $WinSW (Join-Path $target 'nextdesk-ipam-agent.exe')
$xml = Get-Content (Join-Path $PSScriptRoot 'nextdesk-ipam-agent.xml') -Raw
if ($ServiceAccount) {
  $xml = $xml.Replace('</service>', "  <serviceaccount>`n    <username>$ServiceAccount</username>`n    <allowservicelogon>true</allowservicelogon>`n  </serviceaccount>`n</service>")
}
Set-Content -Path (Join-Path $target 'nextdesk-ipam-agent.xml') -Value $xml -Encoding UTF8

$config = Join-Path $data 'config.json'
$provided = Join-Path $source 'config.json'
$example = Join-Path $source 'config.example.json'
$configReady = $true
if (Test-Path $provided) {
  # Fertig ausgefüllte Konfiguration aus nextDesk (Sonde hinzufügen).
  Copy-Item -Force $provided $config
} elseif (-not (Test-Path $config)) {
  $configReady = $false
  if (Test-Path $example) { Copy-Item $example $config }
  Write-Host "Die config.json fehlt. In nextDesk unter «Sonde hinzufügen» herunterladen und als $config ablegen."
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

if (-not $existing) {
  & (Join-Path $target 'nextdesk-ipam-agent.exe') install
}
if ($configReady) {
  & $node (Join-Path $target 'dist\main.js') --config $config --check
  if ($LASTEXITCODE -ne 0) { throw 'Die Verbindung zu nextDesk ist fehlgeschlagen. Dienst nicht gestartet.' }
  Start-Service -Name $serviceName
  Write-Host 'Sonde installiert und gestartet.'
  if (Test-Path $provided) {
    Write-Host "Hinweis: $provided enthält den Zugangsschlüssel und kann jetzt gelöscht werden."
  }
} else {
  Write-Host 'Dienst installiert, aber nicht gestartet. Nach dem Ablegen der config.json: Start-Service nextdesk-ipam-agent'
}
