# Align version across frontend package.json, Tauri Cargo.toml, and tauri.conf.json (semver).
#
# Usage:
#   .\tauri-build\bump-version.ps1 patch | minor | major
#   .\tauri-build\bump-version.ps1 -Explicit "2.5.1"

param(
    [Parameter(Mandatory = $false, Position = 0)]
    [ValidateSet('', 'patch', 'minor', 'major')]
    [string]$Bump = '',
    [string]$Explicit = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $repoRoot 'igltf-editor-frontend'
$pkgPath = Join-Path $frontend 'package.json'
$cargoPath = Join-Path $frontend 'src-tauri\Cargo.toml'
$confPath = Join-Path $frontend 'src-tauri\tauri.conf.json'

function Split-Ver([string]$s) {
    $p = ($s.Trim() -split '\.')
    if ($p.Length -ne 3) {
        throw "Expected MAJOR.MINOR.PATCH, got: '$s'"
    }
    foreach ($part in $p) {
        [void][int]::Parse($part)
    }
    return [int]$p[0], [int]$p[1], [int]$p[2]
}

function Join-Ver([int]$ma, [int]$mi, [int]$pa) {
    return "$ma.$mi.$pa"
}

$pkgRaw = Get-Content -LiteralPath $pkgPath -Raw -Encoding utf8
$m = [regex]::Match($pkgRaw, '"version"\s*:\s*"([^"]+)"')
if (-not $m.Success) { throw "No version field in package.json" }
$cur = $m.Groups[1].Value.Trim()

$newVer = $null
if ($Explicit) {
    Split-Ver $Explicit | Out-Null
    $newVer = $Explicit.Trim()
}
elseif ($Bump) {
    $ma, $mi, $pa = Split-Ver $cur
    switch ($Bump) {
        'major' { $ma++; $mi = 0; $pa = 0 }
        'minor' { $mi++; $pa = 0 }
        'patch' { $pa++ }
    }
    $newVer = Join-Ver $ma $mi $pa
}
else {
    throw "Specify patch|minor|major or use -Explicit 'x.y.z'"
}

Write-Host ("{0} -> {1}" -f $cur, $newVer)

$pkgRaw2 = [regex]::Replace($pkgRaw, '("version"\s*:\s*")[^"]*(")', ('${1}' + $newVer + '${2}'), 1)
Set-Content -LiteralPath $pkgPath -Value $pkgRaw2 -Encoding utf8 -NoNewline

$cargoRaw = Get-Content -LiteralPath $cargoPath -Raw -Encoding utf8
$cargoRaw2 = [regex]::Replace($cargoRaw, '^version\s*=\s*"[^"]*"', ('version = "' + $newVer + '"'), 1)
Set-Content -LiteralPath $cargoPath -Value $cargoRaw2 -Encoding utf8 -NoNewline

$confRaw = Get-Content -LiteralPath $confPath -Raw -Encoding utf8
$confRaw2 = [regex]::Replace($confRaw, '("version"\s*:\s*")[^"]*(")', ('${1}' + $newVer + '${2}'), 1)
Set-Content -LiteralPath $confPath -Value $confRaw2 -Encoding utf8 -NoNewline

Write-Host 'Updated:' $pkgPath
Write-Host 'Updated:' $cargoPath
Write-Host 'Updated:' $confPath
