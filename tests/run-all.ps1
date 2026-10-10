# run-all.ps1 — run every jsdom suite in PARALLEL and report one verdict.
#
# Why: the suites are independent node processes and each spends most of its
# wall-clock in deliberate `await sleep(...)` (debounce, grace, polling). Running
# them at once turns ~60s of sequential waiting into a few seconds.
#
# A suite is judged by its own output: any line containing the word FAIL in
# upper case counts as a failure. (Case matters: "0 failed" is a PASS line.)
param([int]$TimeoutSec = 120)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$outDir = Join-Path $root '.last-run'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# The suites need jsdom. Fail early with a clear instruction rather than 18
# cryptic MODULE_NOT_FOUND errors.
if (-not (Test-Path (Join-Path $root 'node_modules\jsdom'))) {
  Write-Output 'jsdom is not installed. Run:  npm install   (inside the tests folder)'
  exit 1
}

# The suites are grouped by area, so discovery walks the folders. Helper files
# never end in .test.js and are ignored.
$targets = @()
$targets += Get-ChildItem -Path $root -Recurse -Filter '*.test.js' |
  Where-Object { $_.FullName -notmatch 'node_modules|\.last-run' } |
  Sort-Object FullName | ForEach-Object { $_.FullName }
if ($targets.Count -eq 0) { Write-Output 'no test files found'; exit 1 }

$sw = [Diagnostics.Stopwatch]::StartNew()

$jobs = @()
foreach ($file in $targets) {
  # Keep the area folder as a prefix (fill__fill-basic) so the capture names stay
  # unique and readable now that the suites live in subfolders.
  $rel = $file.Substring($root.Length + 1)
  $name = (($rel -replace '[\\/]', '__') -replace '\.js$', '')
  $out = Join-Path $outDir ($name + '.out.txt')
  $err = Join-Path $outDir ($name + '.err.txt')
  $proc = Start-Process -FilePath 'node' -ArgumentList ('"' + $file + '"') -NoNewWindow -PassThru `
    -RedirectStandardOutput $out -RedirectStandardError $err
  $jobs += [pscustomobject]@{ Name = $name; File = $file; Proc = $proc; Out = $out; Err = $err }
}

$problems = @()
foreach ($job in $jobs) {
  $exited = $job.Proc.WaitForExit($TimeoutSec * 1000)
  if (-not $exited) {
    try { $job.Proc.Kill() } catch { }
    $problems += ($job.Name + ': TIMEOUT after ' + $TimeoutSec + 's')
    continue
  }
  # Flush the redirected streams before reading them.
  $job.Proc.WaitForExit()

  $lines = @(Get-Content -Path $job.Out -ErrorAction SilentlyContinue)
  # The summary is printed last, so the final PASS/FAIL line is the verdict.
  $verdict = ($lines | Where-Object { $_ -match 'PASS|FAIL' } | Select-Object -Last 1)
  # Case-SENSITIVE: "0 failed" is part of a PASS line, "FAIL" is not.
  $bad = @($lines | Where-Object { $_ -cmatch 'FAIL' })
  $errors = @(Get-Content -Path $job.Err -ErrorAction SilentlyContinue |
    Where-Object { $_ -match 'Error|Cannot read|not a function' })

  if ($bad.Count -gt 0) { $problems += ($job.Name + ': ' + $bad[0].Trim()) }
  if (-not $verdict) { $problems += ($job.Name + ': printed no verdict (crashed?)') }
  if ($errors.Count -gt 0) { $problems += ($job.Name + ': stderr -> ' + $errors[0].Trim()) }

  $status = if ($bad.Count -eq 0 -and $verdict) { 'PASS' } else { 'FAIL' }
  Write-Output ('{0,-5} {1,-10} {2}' -f $status, $job.Name, ('' + $verdict).Trim())
}

$sw.Stop()
Write-Output ''
if ($problems.Count -eq 0) {
  Write-Output ('ALL GREEN: {0} suites in {1:N1} s (parallel)' -f $jobs.Count, $sw.Elapsed.TotalSeconds)
  exit 0
}
Write-Output ('FAILURES ({0}):' -f $problems.Count)
$problems | ForEach-Object { '  ' + $_ }
Write-Output ('Ran {0} suites in {1:N1} s' -f $jobs.Count, $sw.Elapsed.TotalSeconds)
exit 1
