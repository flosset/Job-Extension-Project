$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression

$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -notmatch '^\d+(\.\d+){0,3}$') {
    throw 'Invalid extension version in manifest.json.'
}
$outputDirectory = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$archivePath = Join-Path $outputDirectory "private-job-autofill-$($manifest.version).zip"

# Explicit allowlist: local settings, fixtures, and test data never enter a release.
$files = @('manifest.json', 'background.js', 'popup.html', 'options.html', 'ui.css', 'LICENSE.md')
foreach ($directory in @('content', 'shared', 'ui')) {
    $files += Get-ChildItem -LiteralPath (Join-Path $projectRoot $directory) -File -Recurse -Filter '*.js' |
        ForEach-Object { $_.FullName.Substring($projectRoot.Length + 1).Replace('\', '/') }
}
foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $file) -PathType Leaf)) {
        throw "Missing release file: $file"
    }
}

$stream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::Create)
try {
    $archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        foreach ($file in ($files | Sort-Object)) {
            $entry = $archive.CreateEntry($file, [System.IO.Compression.CompressionLevel]::Optimal)
            $entryStream = $entry.Open()
            try {
                $bytes = [System.IO.File]::ReadAllBytes((Join-Path $projectRoot $file))
                $entryStream.Write($bytes, 0, $bytes.Length)
            } finally { $entryStream.Dispose() }
        }
    } finally { $archive.Dispose() }
} finally { $stream.Dispose() }
Write-Output "Packaged $($files.Count) files: $archivePath"
