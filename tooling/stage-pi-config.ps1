[CmdletBinding()]
param(
  [string]$PiConfigDir = (Join-Path $env:USERPROFILE '.pi\agent'),
  [string]$Remote = 'study-remote',
  [string]$RemoteRoot = '/root/team-workspaces/qitu-zhixue'
)

$ErrorActionPreference = 'Stop'
$files = @('models.json', 'models-store.json', 'auth.json')

foreach ($file in $files) {
  $path = Join-Path $PiConfigDir $file
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Missing Pi configuration file: $path"
  }
}

# Read only metadata for the operator summary. Never print or log file content.
$models = Get-Content -Raw (Join-Path $PiConfigDir 'models.json') | ConvertFrom-Json
$store = Get-Content -Raw (Join-Path $PiConfigDir 'models-store.json') | ConvertFrom-Json
$providerIds = [System.Collections.Generic.HashSet[string]]::new()
$modelIds = [System.Collections.Generic.HashSet[string]]::new()
foreach ($provider in @($models.providers.psobject.Properties)) {
  [void]$providerIds.Add([string]$provider.Name)
  foreach ($model in @($provider.Value.models)) { [void]$modelIds.Add("$($provider.Name)/$($model.id)") }
}
foreach ($provider in @($store.psobject.Properties)) {
  [void]$providerIds.Add([string]$provider.Name)
  foreach ($model in @($provider.Value.models)) { [void]$modelIds.Add("$($provider.Name)/$($model.id)") }
}

$stage = "$RemoteRoot/.runtime/qitu/pi-import"
$envFile = "$RemoteRoot/.runtime/qitu/pi-import.env"
& ssh -o BatchMode=yes $Remote "install -d -m 700 '$stage' && rm -f '$stage'/*.json"
if ($LASTEXITCODE -ne 0) { throw 'Unable to create the server-side Pi staging directory.' }

foreach ($file in $files) {
  $source = Join-Path $PiConfigDir $file
  & scp -q -- $source "${Remote}:$stage/$file"
  if ($LASTEXITCODE -ne 0) { throw "Unable to copy $file to the server." }
}

& ssh -o BatchMode=yes $Remote "chown -R postgres:postgres '$stage' && chmod 700 '$stage' && chmod 600 '$stage'/*.json && printf '%s\n' 'QITU_PI_CONFIG_DIR=$stage' 'QITU_PI_IMPORT_ON_STARTUP=true' > '$envFile' && chmod 600 '$envFile'"
if ($LASTEXITCODE -ne 0) { throw 'Unable to lock down the server-side Pi staging files.' }

Write-Output "Staged $($providerIds.Count) providers and $($modelIds.Count) unique model declarations."
Write-Output "Run the one-time import with:"
Write-Output "  ssh $Remote `"cd '$RemoteRoot' && QITU_ENV_FILE='$envFile' bash tooling/start-qitu-services.sh restart`""
Write-Output "After a successful import, remove the staging files and env file; provider keys are already encrypted in PostgreSQL."
