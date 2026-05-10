$ErrorActionPreference = 'Stop'

$serviceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$payloadOverridePath = Join-Path $serviceDir 'preview-inputs\timed-words.json'
$samplePayloadPath = Join-Path $serviceDir 'examples\sample-payload.json'
$resolvedPayloadPath = Join-Path $serviceDir 'preview-inputs\resolved-preview-payload.json'
$outputDir = Join-Path $serviceDir 'preview-out'

function Resolve-PayloadShape($value) {
  if ($value -is [System.Array]) {
    return Resolve-PayloadShape $value[0]
  }

  if ($null -ne $value.client_payload) {
    return Resolve-PayloadShape $value.client_payload
  }

  if ($null -ne $value.json) {
    return Resolve-PayloadShape $value.json
  }

  return $value
}

function Merge-PayloadObjects($basePayload, $overridePayload) {
  $merged = [ordered]@{}

  foreach ($property in $basePayload.PSObject.Properties) {
    $merged[$property.Name] = $property.Value
  }

  if ($null -ne $overridePayload) {
    foreach ($property in $overridePayload.PSObject.Properties) {
      $merged[$property.Name] = $property.Value
    }
  }

  return $merged
}

$basePayloadRaw = Get-Content $samplePayloadPath -Raw | ConvertFrom-Json
$basePayload = Resolve-PayloadShape $basePayloadRaw
$overridePayload = $null

if (Test-Path $payloadOverridePath) {
  $overridePayloadRaw = Get-Content $payloadOverridePath -Raw | ConvertFrom-Json
  $overridePayload = Resolve-PayloadShape $overridePayloadRaw
}

$resolvedPayload = Merge-PayloadObjects $basePayload $overridePayload
$resolvedPayloadJson = @{ client_payload = $resolvedPayload } | ConvertTo-Json -Depth 100
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($resolvedPayloadPath, $resolvedPayloadJson, $utf8NoBom)
$payloadPath = $resolvedPayloadPath

Push-Location $serviceDir
try {
  if (-not (Test-Path (Join-Path $serviceDir 'node_modules'))) {
    npm install
  }

  $env:GITHUB_EVENT_PATH = $payloadPath
  $env:RENDER_PREVIEW = '1'
  $env:PREVIEW_OUTPUT_DIR = $outputDir

  npm run render
}
finally {
  Pop-Location
}
