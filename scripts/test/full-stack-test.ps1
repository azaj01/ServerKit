#requires -Version 5.1
<#
.SYNOPSIS
  One-click full-stack E2E test for ServerKit on Windows. Sequential edition.

.DESCRIPTION
  For each distro, in turn: launch VM via Multipass, upload local working
  tree, run installer, run pytest harness, collect results. Aggregates into
  a single HTML report.

  Sequential by design — Start-Job's separate runspace makes parameter
  passing and command resolution fragile enough that parallel is not worth
  the debugging cost.

.PARAMETER Distros
  Distros to test. Default: ubuntu22, ubuntu24, debian12.

.PARAMETER Only
  Comma-separated subset (e.g. -Only "ubuntu24").

.PARAMETER Keep
  Don't delete VMs at end.

.PARAMETER ReuseVm
  Skip launch + install; use an already-running sk-test-* VM. Useful for
  re-running just the harness after an install succeeded.
#>
[CmdletBinding()]
param(
    # Default suite: Ubuntu LTSes via Multipass + non-Ubuntu via Vagrant
    # + Hyper-V provider. Vagrant boxes are heavier (first launch downloads
    # ~600 MB each), so first full run is long. -Only to subset.
    [string[]] $Distros = @('ubuntu22','ubuntu24','debian12','fedora','rocky9'),
    [string]   $Only,
    [switch]   $Keep,
    [string]   $ReuseVm,
    [int]      $Cpus = 2,
    [int]      $MemoryGB = 4,
    [int]      $DiskGB = 15
)

# NB: keep ErrorActionPreference at Continue. Multipass writes harmless
# warnings to stderr (e.g. "cannot set permissions" when transferring to
# NTFS) and 'Stop' turns those into fatal script errors.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

# DistroMap drives both dispatch and image/box selection.
# backend: 'multipass' uses the Canonical Ubuntu images; 'vagrant' uses
# the Hyper-V provider with generic/* boxes. The login user differs by
# backend (ubuntu vs vagrant), which matters for chown on the harness dir.
$DistroMap = @{
    'ubuntu22' = @{ backend = 'multipass'; image = '22.04';              user = 'ubuntu'  }
    'ubuntu24' = @{ backend = 'multipass'; image = '24.04';              user = 'ubuntu'  }
    'debian12' = @{ backend = 'vagrant';   image = 'generic/debian12';   user = 'vagrant' }
    'fedora'   = @{ backend = 'vagrant';   image = 'generic/fedora39';   user = 'vagrant' }
    'rocky9'   = @{ backend = 'vagrant';   image = 'generic/rocky9';     user = 'vagrant' }
}

if ($Only) {
    $requested = $Only -split ','
    $Distros = $Distros | Where-Object { $_ -in $requested }
}

$RepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$RunId    = Get-Date -Format 'yyyyMMdd-HHmmss'
$OutDir   = Join-Path $PSScriptRoot "output\$RunId"
$null     = New-Item -ItemType Directory -Force -Path $OutDir

# Seed state.json immediately so any early refresh of the report shows
# "running" rather than treating an empty dir as a failed run.
Set-Content -Path (Join-Path $OutDir 'state.json') -Value '{"running":true,"vms":{}}' -Encoding utf8

# --- locate backends -----------------------------------------------------
function Find-Exe {
    param([string[]] $Paths, [string] $Cmd)
    foreach ($p in $Paths) { if (Test-Path $p) { return $p } }
    return (Get-Command $Cmd -ErrorAction SilentlyContinue).Source
}

$MpExe = Find-Exe -Cmd 'multipass' -Paths @(
    'C:\Program Files\Multipass\bin\multipass.exe',
    "$env:LOCALAPPDATA\Programs\Multipass\bin\multipass.exe"
)
$VgExe = Find-Exe -Cmd 'vagrant' -Paths @(
    'C:\Program Files\Vagrant\bin\vagrant.exe',
    "$env:LOCALAPPDATA\Programs\Vagrant\bin\vagrant.exe"
)

# Filter distros down to whichever backends are actually installed.
$missing = @()
$Distros = $Distros | Where-Object {
    $entry = $DistroMap[$_]
    if (-not $entry) { return $false }
    if ($entry.backend -eq 'multipass' -and -not $MpExe) { $missing += "$_ (needs Multipass)"; return $false }
    if ($entry.backend -eq 'vagrant'   -and -not $VgExe) { $missing += "$_ (needs Vagrant)"; return $false }
    $true
}

if (-not $Distros -or $Distros.Count -eq 0) {
    Write-Host "No runnable distros. Install Multipass and/or Vagrant first." -ForegroundColor Red
    if ($missing) { $missing | ForEach-Object { Write-Host "  skipped: $_" -ForegroundColor Yellow } }
    exit 2
}

# Vagrant + Hyper-V requires the process itself to run elevated. Being in
# the Hyper-V Administrators group is necessary but not sufficient.
$needsAdmin = $Distros | Where-Object { $DistroMap[$_].backend -eq 'vagrant' }
if ($needsAdmin) {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host "" -ForegroundColor Red
        Write-Host "Vagrant + Hyper-V requires an elevated PowerShell." -ForegroundColor Red
        Write-Host "Requested distros that need it: $($needsAdmin -join ', ')" -ForegroundColor Red
        Write-Host "" -ForegroundColor Red
        Write-Host "Either:" -ForegroundColor Yellow
        Write-Host "  1. Right-click PowerShell -> Run as Administrator, then re-run this script." -ForegroundColor Yellow
        Write-Host "  2. Or run with -Only ubuntu22,ubuntu24 to skip Vagrant distros." -ForegroundColor Yellow
        exit 2
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " ServerKit E2E Test - run $RunId" -ForegroundColor Cyan
if ($MpExe) { Write-Host " Multipass: $MpExe" -ForegroundColor Cyan }
if ($VgExe) { Write-Host " Vagrant:   $VgExe" -ForegroundColor Cyan }
Write-Host " Distros:   $($Distros -join ', ')" -ForegroundColor Cyan
if ($missing) { $missing | ForEach-Object { Write-Host " skipped:   $_" -ForegroundColor Yellow } }
Write-Host " Output:    $OutDir" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# NB: 'mp' is a built-in PS alias for Move-ItemProperty, so we must NOT
# define a helper function named Mp. Use $MpExe directly everywhere.

# --- live state + report regen ------------------------------------------
$script:State = @{ running = $true; vms = @{} }
function Save-State {
    $json = $script:State | ConvertTo-Json -Depth 5 -Compress
    Set-Content -Path (Join-Path $OutDir 'state.json') -Value $json -Encoding utf8
    if (Get-Command python -ErrorAction SilentlyContinue) {
        & python (Join-Path $PSScriptRoot 'report.py') $OutDir 2>&1 | Out-Null
    }
}
function Set-VmStage {
    param([string]$Vm, [string]$Stage)
    if (-not $script:State.vms.ContainsKey($Vm)) { $script:State.vms[$Vm] = @{} }
    $script:State.vms[$Vm].stage = $Stage
    Save-State
}

function Test-VmInstall {
    param([string]$Vm, [string]$VmOut, [string]$Tarball, [string]$VmInstallScript, [string]$HarnessDir)

    New-Item -ItemType Directory -Force -Path $VmOut | Out-Null
    $statusFile = Join-Path $VmOut 'install-status'

    Set-VmStage -Vm $Vm -Stage 'transferring source'
    Write-Host "  [$Vm] transferring source ($([math]::Round((Get-Item $Tarball).Length/1MB,1)) MB)..." -ForegroundColor DarkCyan
    & $MpExe transfer $Tarball "${Vm}:/tmp/serverkit-src.tar.gz" 2>&1 | Out-Null
    & $MpExe transfer $VmInstallScript "${Vm}:/tmp/vm-install.sh" 2>&1 | Out-Null
    & $MpExe exec $Vm -- sudo mkdir -p /opt/serverkit-src 2>&1 | Out-Null
    & $MpExe exec $Vm -- sudo tar -xzf /tmp/serverkit-src.tar.gz -C /opt/serverkit-src 2>&1 | Out-Null
    & $MpExe exec $Vm -- sudo chmod +x /tmp/vm-install.sh 2>&1 | Out-Null

    Set-VmStage -Vm $Vm -Stage 'installing (npm ci + build, ~10 min)'
    Write-Host "  [$Vm] running install (this is the long part)..." -ForegroundColor DarkCyan
    & $MpExe exec $Vm -- sh -c "sudo bash /tmp/vm-install.sh > /tmp/vm-install-stdout.log 2>&1; rc=`$?; echo EXIT_RC=`$rc; exit `$rc" `
        | Out-File (Join-Path $VmOut 'install.log') -Encoding utf8
    $installRC = $LASTEXITCODE

    & $MpExe transfer "${Vm}:/var/log/serverkit-test-install.log" "$VmOut\vm-install.log" 2>&1 | Out-Null
    & $MpExe transfer "${Vm}:/tmp/serverkit-install-status" $statusFile 2>&1 | Out-Null
    if (-not (Test-Path $statusFile) -or (Get-Content $statusFile -Raw -ErrorAction SilentlyContinue).Trim() -eq '') {
        $fallback = if ($installRC -eq 0) { 'OK' } else { 'FAIL' }
        Set-Content -Path $statusFile -Value $fallback -Encoding ascii
    }
    & $MpExe exec $Vm -- sudo journalctl -u serverkit --no-pager -n 500 2>&1 `
        | Out-File (Join-Path $VmOut 'journalctl.log') -Encoding utf8

    $status = (Get-Content $statusFile -Raw).Trim()
    Write-Host "  [$Vm] install status: $status" -ForegroundColor $(if ($status -eq 'OK') { 'Green' } else { 'Red' })
    Save-State  # regenerate so install log + journalctl show up

    if ($status -ne 'OK') {
        Set-VmStage -Vm $Vm -Stage 'install failed'
        return $status
    }

    Set-VmStage -Vm $Vm -Stage 'running pytest'
    Write-Host "  [$Vm] running pytest harness..." -ForegroundColor DarkCyan
    & $MpExe exec $Vm -- sudo mkdir -p /opt/serverkit-test 2>&1 | Out-Null
    & $MpExe exec $Vm -- sudo chown ubuntu:ubuntu /opt/serverkit-test 2>&1 | Out-Null
    Get-ChildItem $HarnessDir -File | ForEach-Object {
        & $MpExe transfer $_.FullName "${Vm}:/opt/serverkit-test/$($_.Name)" 2>&1 | Out-Null
    }
    & $MpExe exec $Vm -- sudo /opt/serverkit/venv/bin/pip install -r /opt/serverkit-test/requirements.txt 2>&1 `
        | Out-File (Join-Path $VmOut 'harness-deps.log') -Encoding utf8
    & $MpExe exec $Vm -- sh -c "sudo /opt/serverkit/venv/bin/python -m pytest /opt/serverkit-test --json-report --json-report-file=/opt/serverkit-test/pytest-report.json -v > /tmp/pytest-stdout.log 2>&1; rc=`$?; echo EXIT_RC=`$rc; exit `$rc" `
        | Out-File (Join-Path $VmOut 'pytest.log') -Encoding utf8
    & $MpExe transfer "${Vm}:/tmp/pytest-stdout.log" (Join-Path $VmOut 'pytest-stdout.log') 2>&1 | Out-Null
    & $MpExe transfer "${Vm}:/opt/serverkit-test/pytest-report.json" (Join-Path $VmOut 'pytest-report.json') 2>&1 | Out-Null

    Set-VmStage -Vm $Vm -Stage 'done'
    return $status
}

function Test-VagrantInstall {
    # Vagrant equivalent of Test-VmInstall. Uses 'vagrant upload' for file
    # transfer (added in 2.2.7) and 'vagrant ssh -c' for exec. Each VM
    # gets its own VAGRANT_CWD so multiple distros can coexist.
    param([string]$Vm, [string]$VmOut, [string]$Tarball, [string]$VmInstallScript, [string]$HarnessDir, [string]$Box, [string]$User)

    New-Item -ItemType Directory -Force -Path $VmOut | Out-Null
    $statusFile = Join-Path $VmOut 'install-status'

    # Per-VM Vagrant working dir holding the Vagrantfile + .vagrant state.
    $vagrantSrc = Join-Path $PSScriptRoot 'vagrant\Vagrantfile'
    $vagrantCwd = Join-Path $OutDir "vagrant-state\$Vm"
    New-Item -ItemType Directory -Force -Path $vagrantCwd | Out-Null
    Copy-Item $vagrantSrc (Join-Path $vagrantCwd 'Vagrantfile') -Force

    $env:VAGRANT_CWD    = $vagrantCwd
    $env:SK_BOX         = $Box
    $env:SK_VM_NAME     = $Vm
    $env:SK_CPUS        = "$Cpus"
    $env:SK_MEMORY_MB   = "$($MemoryGB * 1024)"

    Set-VmStage -Vm $Vm -Stage 'launching VM (vagrant up, ~5-10 min first time)'
    Write-Host "  [$Vm] vagrant up..." -ForegroundColor DarkCyan
    & $VgExe up --provider=hyperv 2>&1 | Out-File (Join-Path $VmOut 'vagrant-up.log') -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
        Set-Content -Path $statusFile -Value 'LAUNCH_FAILED' -Encoding ascii
        Set-VmStage -Vm $Vm -Stage 'launch failed'
        return 'LAUNCH_FAILED'
    }

    Set-VmStage -Vm $Vm -Stage 'transferring source'
    Write-Host "  [$Vm] transferring source..." -ForegroundColor DarkCyan
    & $VgExe upload $Tarball /tmp/serverkit-src.tar.gz       2>&1 | Out-Null
    & $VgExe upload $VmInstallScript /tmp/vm-install.sh      2>&1 | Out-Null
    & $VgExe ssh -c "sudo mkdir -p /opt/serverkit-src && sudo tar -xzf /tmp/serverkit-src.tar.gz -C /opt/serverkit-src && sudo chmod +x /tmp/vm-install.sh" 2>&1 | Out-Null

    Set-VmStage -Vm $Vm -Stage 'installing (npm ci + build, ~10 min)'
    Write-Host "  [$Vm] running install..." -ForegroundColor DarkCyan
    & $VgExe ssh -c "sudo bash /tmp/vm-install.sh > /tmp/vm-install-stdout.log 2>&1; rc=`$?; echo EXIT_RC=`$rc; exit `$rc" `
        2>&1 | Out-File (Join-Path $VmOut 'install.log') -Encoding utf8
    $installRC = $LASTEXITCODE

    # Pull canonical logs back. vagrant scp would need a plugin; we
    # cat-then-redirect via vagrant ssh, which is universal.
    & $VgExe ssh -c "sudo cat /var/log/serverkit-test-install.log" 2>$null `
        | Out-File (Join-Path $VmOut 'vm-install.log') -Encoding utf8
    & $VgExe ssh -c "sudo cat /tmp/serverkit-install-status" 2>$null `
        | Out-File $statusFile -Encoding ascii
    if (-not (Test-Path $statusFile) -or (Get-Content $statusFile -Raw -ErrorAction SilentlyContinue).Trim() -eq '') {
        $fallback = if ($installRC -eq 0) { 'OK' } else { 'FAIL' }
        Set-Content -Path $statusFile -Value $fallback -Encoding ascii
    }
    & $VgExe ssh -c "sudo journalctl -u serverkit --no-pager -n 500" 2>$null `
        | Out-File (Join-Path $VmOut 'journalctl.log') -Encoding utf8

    $status = (Get-Content $statusFile -Raw).Trim()
    Write-Host "  [$Vm] install status: $status" -ForegroundColor $(if ($status -eq 'OK') { 'Green' } else { 'Red' })
    Save-State

    if ($status -ne 'OK') {
        Set-VmStage -Vm $Vm -Stage 'install failed'
        return $status
    }

    Set-VmStage -Vm $Vm -Stage 'running pytest'
    Write-Host "  [$Vm] running pytest harness..." -ForegroundColor DarkCyan
    & $VgExe ssh -c "sudo mkdir -p /opt/serverkit-test && sudo chown ${User}:${User} /opt/serverkit-test" 2>&1 | Out-Null
    Get-ChildItem $HarnessDir -File | ForEach-Object {
        & $VgExe upload $_.FullName "/opt/serverkit-test/$($_.Name)" 2>&1 | Out-Null
    }
    & $VgExe ssh -c "sudo /opt/serverkit/venv/bin/pip install -r /opt/serverkit-test/requirements.txt" 2>&1 `
        | Out-File (Join-Path $VmOut 'harness-deps.log') -Encoding utf8
    & $VgExe ssh -c "sudo /opt/serverkit/venv/bin/python -m pytest /opt/serverkit-test --json-report --json-report-file=/opt/serverkit-test/pytest-report.json -v > /tmp/pytest-stdout.log 2>&1; rc=`$?; echo EXIT_RC=`$rc; exit `$rc" `
        2>&1 | Out-File (Join-Path $VmOut 'pytest.log') -Encoding utf8
    & $VgExe ssh -c "sudo cat /tmp/pytest-stdout.log"                 2>$null | Out-File (Join-Path $VmOut 'pytest-stdout.log') -Encoding utf8
    & $VgExe ssh -c "sudo cat /opt/serverkit-test/pytest-report.json" 2>$null | Out-File (Join-Path $VmOut 'pytest-report.json') -Encoding utf8

    Set-VmStage -Vm $Vm -Stage 'done'
    return $status
}

function Remove-VagrantVm {
    param([string]$Vm)
    $vagrantCwd = Join-Path $OutDir "vagrant-state\$Vm"
    if (-not (Test-Path $vagrantCwd)) { return }
    $env:VAGRANT_CWD = $vagrantCwd
    & $VgExe destroy -f 2>&1 | Out-Null
}

# --- pack source --------------------------------------------------------
$Tarball = Join-Path $OutDir 'serverkit-src.tar.gz'
Write-Host "`n[1/4] Packing local working tree -> $Tarball" -ForegroundColor Yellow
Push-Location $RepoRoot
try {
    & tar --exclude='.git' `
          --exclude='venv' `
          --exclude='.venv' `
          --exclude='.venv-wsl' `
          --exclude='node_modules' `
          --exclude='dist' `
          --exclude='__pycache__' `
          --exclude='instance' `
          --exclude='target' `
          --exclude='build' `
          --exclude='*.exe' `
          --exclude='*.msi' `
          --exclude='scripts/test/output' `
          -czf $Tarball -C $RepoRoot .
    if ($LASTEXITCODE -ne 0) { throw "tar failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}
Write-Host ("    Tarball: {0:N1} MB" -f ((Get-Item $Tarball).Length / 1MB))

# --- main loop ----------------------------------------------------------
$results = @()
$liveVMs = @()
$vmInstallScript = Join-Path $PSScriptRoot 'vm-install.sh'
$cloudInit = Join-Path $PSScriptRoot 'cloud-init\base.yaml'
$harnessDir = Join-Path $PSScriptRoot 'harness'

# Pre-populate stages and seed the live report, then open it in the browser.
foreach ($d in $Distros) {
    $vmName = if ($ReuseVm) { $ReuseVm } else { "sk-test-$d-$RunId" }
    $script:State.vms[$vmName] = @{ stage = 'pending' }
    if ($ReuseVm) { break }
}
Save-State
$reportPath = Join-Path $OutDir 'report.html'
if (Test-Path $reportPath) {
    Write-Host "`nLive report: $reportPath (opening in browser)" -ForegroundColor Cyan
    Start-Process $reportPath
}

if ($ReuseVm) {
    Write-Host "`n[2-3/4] Reusing VM: $ReuseVm" -ForegroundColor Yellow
    $vmOut = Join-Path $OutDir $ReuseVm
    # Reuse only supports Multipass for now (Vagrant VMs are tied to a
    # specific VAGRANT_CWD that doesn't exist outside the original run).
    $status = Test-VmInstall -Vm $ReuseVm -VmOut $vmOut -Tarball $Tarball `
                              -VmInstallScript $vmInstallScript -HarnessDir $harnessDir
    $results += @{ Name = $ReuseVm; Status = $status }
    $liveVMs += @{ Name = $ReuseVm; Backend = 'multipass' }
} else {
    Write-Host "`n[2/4] Launching + testing $($Distros.Count) VM(s) sequentially..." -ForegroundColor Yellow
    foreach ($d in $Distros) {
        $vmName = "sk-test-$d-$RunId"
        $entry = $DistroMap[$d]
        $vmOut = Join-Path $OutDir $vmName

        Write-Host "`n--- $d ($($entry.backend)) ---" -ForegroundColor Yellow

        if ($entry.backend -eq 'multipass') {
            Write-Host "  Launching $vmName from image $($entry.image)..." -ForegroundColor DarkCyan
            & $MpExe launch $entry.image --name $vmName --cpus $Cpus --memory "${MemoryGB}G" --disk "${DiskGB}G" --cloud-init $cloudInit
            if ($LASTEXITCODE -ne 0) {
                Write-Host "  [FAIL] $vmName launch failed" -ForegroundColor Red
                $results += @{ Name = $vmName; Status = 'LAUNCH_FAILED' }
                continue
            }
            Write-Host "  [OK] $vmName launched" -ForegroundColor Green
            $liveVMs += @{ Name = $vmName; Backend = 'multipass' }
            $status = Test-VmInstall -Vm $vmName -VmOut $vmOut -Tarball $Tarball `
                                      -VmInstallScript $vmInstallScript -HarnessDir $harnessDir
            $results += @{ Name = $vmName; Status = $status }
        }
        elseif ($entry.backend -eq 'vagrant') {
            Write-Host "  Bringing up $vmName via Vagrant (box: $($entry.image))..." -ForegroundColor DarkCyan
            $liveVMs += @{ Name = $vmName; Backend = 'vagrant' }
            $status = Test-VagrantInstall -Vm $vmName -VmOut $vmOut -Tarball $Tarball `
                                           -VmInstallScript $vmInstallScript -HarnessDir $harnessDir `
                                           -Box $entry.image -User $entry.user
            $results += @{ Name = $vmName; Status = $status }
        }
    }
}

# --- report -------------------------------------------------------------
Write-Host "`n[4/4] Finalizing HTML report..." -ForegroundColor Yellow
$script:State.running = $false
Save-State
$reportHtml = Join-Path $OutDir 'report.html'
if (Test-Path $reportHtml) {
    Write-Host "    Report: $reportHtml" -ForegroundColor Green
} else {
    Write-Host "    python not on PATH. Raw output: $OutDir" -ForegroundColor Yellow
    $reportHtml = $null
}

# --- teardown -----------------------------------------------------------
if ($Keep -or $ReuseVm) {
    Write-Host "`nVMs left running:" -ForegroundColor Yellow
    $liveVMs | ForEach-Object { Write-Host "  - $($_.Name) ($($_.Backend))" }
} else {
    Write-Host "`nTearing down VMs..." -ForegroundColor Yellow
    foreach ($vm in $liveVMs) {
        if ($vm.Backend -eq 'multipass') {
            & $MpExe delete $vm.Name 2>&1 | Out-Null
        } elseif ($vm.Backend -eq 'vagrant') {
            Remove-VagrantVm -Vm $vm.Name
        }
    }
    if ($MpExe) { & $MpExe purge 2>&1 | Out-Null }
}

# --- summary ------------------------------------------------------------
$failed = @($results | Where-Object { $_.Status -ne 'OK' })
Write-Host ""
if ($failed.Count -eq 0 -and $results.Count -gt 0) {
    Write-Host "ALL GREEN - $($results.Count) VM(s) passed." -ForegroundColor Green
    exit 0
} else {
    Write-Host "FAILURES on $($failed.Count) VM(s):" -ForegroundColor Red
    $failed | ForEach-Object { Write-Host "  - $($_.Name): $($_.Status)" -ForegroundColor Red }
    exit 1
}
