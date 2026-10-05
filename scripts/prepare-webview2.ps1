$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$downloadRoot = Join-Path $projectRoot 'bin/webview2-download'
$runtime = Join-Path $projectRoot 'resources/WebView2'
New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null

$page = Invoke-WebRequest -Uri 'https://developer.microsoft.com/en-us/microsoft-edge/webview2/' -UseBasicParsing
$content = $page.Content.Replace('\u002F', '/')
$pattern = 'https://msedge\.sf\.dl\.delivery\.mp\.microsoft\.com/filestreamingservice/files/[0-9a-f-]+/Microsoft\.WebView2\.FixedVersionRuntime\.(\d+\.\d+\.\d+\.\d+)\.x64\.cab'
$match = [regex]::Matches($content, $pattern) | Sort-Object { [version]$_.Groups[1].Value } -Descending | Select-Object -First 1
if ($null -eq $match) { throw 'Cannot find the official WebView2 Fixed Version Runtime x64 download.' }

$cab = Join-Path $downloadRoot 'WebView2.x64.cab'
$expanded = Join-Path $downloadRoot 'expanded'
Write-Output "Downloading WebView2 Fixed Version Runtime $($match.Groups[1].Value) (x64)."
Invoke-WebRequest -Uri $match.Value -OutFile $cab -UseBasicParsing
if (Test-Path -LiteralPath $expanded) { Remove-Item -LiteralPath $expanded -Recurse -Force }
New-Item -ItemType Directory -Path $expanded | Out-Null
& expand.exe $cab '-F:*' $expanded | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot extract the WebView2 runtime CAB.' }

$executables = @(Get-ChildItem -LiteralPath $expanded -Recurse -File -Filter msedgewebview2.exe)
if ($executables.Count -ne 1) { throw 'Expected exactly one WebView2 runtime executable.' }
$signature = Get-AuthenticodeSignature -LiteralPath $executables[0].FullName
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(?:,|$)') {
  throw 'WebView2 runtime executable does not have a valid Microsoft signature.'
}
$source = $executables[0].DirectoryName
$dll = Join-Path $source 'EBWebView/x64/EmbeddedBrowserWebView.dll'
if (-not (Test-Path -LiteralPath $dll -PathType Leaf)) { throw 'WebView2 x64 runtime is incomplete.' }
if (Test-Path -LiteralPath $runtime) { Remove-Item -LiteralPath $runtime -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Split-Path $runtime -Parent) | Out-Null
Copy-Item -LiteralPath $source -Destination $runtime -Recurse
Write-Output "WebView2 runtime prepared: $runtime"
