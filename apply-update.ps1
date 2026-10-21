# dsh-auto-update - detached installer / restarter
#
# Runs OUTSIDE the web host process tree (spawned detached by the plugin), so
# stopping the host cannot abort this script. That self-kill was the failure
# mode behind every truncated restart script on this machine.
#
# Modes:
#   apply    - install <Version> side by side, smoke test it, repoint the
#              launcher pointer, restart the web host, health check, and roll
#              back automatically when the new host does not come up.
#   rollback - repoint the launcher pointer back to <TargetRoot> and restart.
#
# ASCII-only, Windows PowerShell 5.1 compatible.

param(
    [ValidateSet('apply', 'rollback', 'restart')]
    [string]$Mode = 'apply',
    [string]$Version = '',
    [string]$CurrentRoot = '',
    [string]$TargetRoot = '',
    [string]$StateDir = '',
    [string]$LauncherDir = '',
    [string]$LaunchCmd = '',
    [int]$Port = 3080,
    [switch]$DryRun,
    [switch]$StageOnly,
    [string]$Registry = '',
    [string]$BootLog = '',
    [string]$Stage2Reason = '',
    # The plugin passes everything through this JSON file instead of the command
    # line. powershell.exe -File drops empty arguments ("Missing an argument for
    # parameter 'X'"), and a binding failure in a detached process used to be
    # invisible: the API reported "started" while nothing ran. A file has no
    # quoting, empty-value, or non-ASCII argv problems.
    [string]$ArgsFile = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ($ArgsFile) {
    $cfg = Get-Content -Path $ArgsFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($cfg.mode) { $Mode = [string]$cfg.mode }
    if ($cfg.version) { $Version = [string]$cfg.version }
    if ($cfg.currentRoot) { $CurrentRoot = [string]$cfg.currentRoot }
    if ($cfg.targetRoot) { $TargetRoot = [string]$cfg.targetRoot }
    if ($cfg.stateDir) { $StateDir = [string]$cfg.stateDir }
    if ($cfg.launcherDir) { $LauncherDir = [string]$cfg.launcherDir }
    if ($cfg.launchCmd) { $LaunchCmd = [string]$cfg.launchCmd }
    if ($cfg.bootLog) { $BootLog = [string]$cfg.bootLog }
    if ($cfg.registry) { $Registry = [string]$cfg.registry }
    if ($cfg.stage2Reason) { $Stage2Reason = [string]$cfg.stage2Reason }
    if ($cfg.port) { $Port = [int]$cfg.port }
    if ($cfg.dryRun) { $DryRun = $true }
    if ($cfg.stageOnly) { $StageOnly = $true }
}

# Empty means "let npm use its own configured registry". A mirror can be the
# difference between minutes and hours: registry.npmjs.org served several
# tarballs at a few KB/s from this host.
if (-not $Registry) { $Registry = $env:DSH_AUTO_UPDATE_REGISTRY }

if (-not $StateDir) {
    $stateHome = $env:DSH_HOME
    if (-not $stateHome) { $stateHome = Join-Path $env:USERPROFILE 'Documents\Codex\2026-08-14\w\dsh-home' }
    $StateDir = Join-Path $stateHome 'auto-update'
}
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
# Portable defaults: nothing below assumes a particular machine layout. This
# machine passes the same values through DSH_AUTO_UPDATE_* (see README) or the
# plugin passes them as parameters.
if (-not $LauncherDir) { $LauncherDir = $env:DSH_AUTO_UPDATE_LAUNCHER_DIR }
if (-not $LauncherDir) { $LauncherDir = Join-Path $StateDir 'launcher' }
if (-not $LaunchCmd) { $LaunchCmd = $env:DSH_AUTO_UPDATE_LAUNCH_CMD }
if (-not $BootLog) { $BootLog = $env:DSH_AUTO_UPDATE_BOOT_LOG }
New-Item -ItemType Directory -Force -Path $LauncherDir | Out-Null

$LogFile         = Join-Path $StateDir 'update.log'
$LockFile        = Join-Path $StateDir 'apply.lock'
$ResultFile      = Join-Path $StateDir 'last-result.json'
$PointerFile     = Join-Path $LauncherDir 'current-root.txt'
$PreviousPointer = Join-Path $StateDir 'previous-root.txt'
$HealthUrl       = "http://127.0.0.1:$Port/api/pair/status"

# Installs live at <base>\dsh-install-<version>. Derive the base instead of
# hardcoding it: this account's home path is non-ASCII.
if ($CurrentRoot) {
    $InstallBase = Split-Path $CurrentRoot -Parent
} elseif ($env:DSH_HOME) {
    $InstallBase = Split-Path $env:DSH_HOME -Parent
} else {
    $InstallBase = Join-Path $env:USERPROFILE 'Documents\Codex\2026-08-14\w'
}

function Write-Log([string]$Text) {
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text
    Add-Content -Path $LogFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    Write-Host $line
}

function Write-Result([string]$Status, [string]$Detail) {
    # A dry run is a probe, not an outcome. Recording it would erase the last
    # real verdict from the settings card (and from `last-result.json`, which is
    # the only durable history besides update.log).
    if ($DryRun.IsPresent) {
        Write-Log "dry run (not recorded as a result): $Status - $Detail"
        return
    }
    $to = ''
    if (Test-Path $PointerFile) { $to = (Get-Content $PointerFile -Raw).Trim() }
    $payload = [ordered]@{
        at      = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        mode    = $Mode
        version = $Version
        status  = $Status
        detail  = $Detail
        from    = $CurrentRoot
        to      = $to
    }
    try {
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [IO.File]::WriteAllText($ResultFile, ($payload | ConvertTo-Json -Depth 4), $utf8NoBom)
    } catch {
        Write-Log "could not write result file: $($_.Exception.Message)"
    }
}

function Get-WebBin([string]$Root) {
    if (-not $Root) { throw 'no install root given (pass -CurrentRoot, or write the launcher pointer)' }
    return (Join-Path $Root 'node_modules\@deepseek-ai\dsh\lib\bin.js')
}

function Get-InstalledVersion([string]$Root) {
    $manifest = Join-Path $Root 'node_modules\@deepseek-ai\dsh\package.json'
    if (-not (Test-Path $manifest)) { return $null }
    try { return (Get-Content $manifest -Raw | ConvertFrom-Json).version } catch { return $null }
}

function Get-PortOwners([int]$LocalPort) {
    $owners = @()
    try {
        Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue |
            ForEach-Object { $owners += [int]$_.OwningProcess }
    } catch {
        Write-Log "port scan failed: $($_.Exception.Message)"
    }
    return ($owners | Sort-Object -Unique)
}

function Test-WebListening([int]$LocalPort) {
    return ((Get-PortOwners $LocalPort).Count -gt 0)
}

function Stop-WebHost {
    $targets = @()
    $targets += Get-PortOwners $Port
    try {
        Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
            if ($_.CommandLine -and $_.CommandLine -match '--profile\s+web') { $targets += [int]$_.ProcessId }
        }
    } catch {
        Write-Log "process scan failed: $($_.Exception.Message)"
    }
    # The launcher wrapper has to go too. A start-web.cmd that survives the stop
    # can restart the OLD version and win the port before the new one boots,
    # which is exactly how one upgrade reported success while nothing changed.
    if ($LaunchCmd) {
        $launchLeaf = Split-Path $LaunchCmd -Leaf
        try {
            Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
                if ($_.CommandLine -and $_.CommandLine -like "*$launchLeaf*") {
                    Write-Log "stopping launcher wrapper $($_.ProcessId) ($launchLeaf)"
                    $targets += [int]$_.ProcessId
                }
            }
        } catch {
            Write-Log "launcher scan failed: $($_.Exception.Message)"
        }
    }
    $targets = $targets | Sort-Object -Unique
    if ($targets.Count -eq 0) {
        Write-Log 'no running web host found'
        return 0
    }
    foreach ($pid_ in $targets) {
        try {
            Stop-Process -Id $pid_ -Force -ErrorAction Stop
            Write-Log "stopped web process $pid_"
        } catch {
            Write-Log "could not stop ${pid_}: $($_.Exception.Message)"
        }
    }
    $deadline = (Get-Date).AddSeconds(45)
    while ((Test-WebListening $Port) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 400 }
    if (Test-WebListening $Port) { Write-Log 'WARNING: port is still listening after stop' }
    return $targets.Count
}

function Start-WebHost {
    if (-not (Test-Path $LaunchCmd)) { throw "launch command not found: $LaunchCmd" }
    $arguments = '/c ""{0}""' -f $LaunchCmd
    Start-Process -FilePath $env:ComSpec -ArgumentList $arguments -WorkingDirectory (Split-Path $LaunchCmd -Parent) -WindowStyle Hidden | Out-Null
    Write-Log "launched $LaunchCmd"
}

function Test-PortOpen([int]$LocalPort, [int]$TimeoutMs = 1500) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect('127.0.0.1', $LocalPort, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne($TimeoutMs)
        $connected = ($ok -and $client.Connected)
        $client.Close()
        return $connected
    } catch {
        return $false
    }
}

function Get-RunningVersion {
    # Identity of what is actually serving the port. "HTTP 200 on the health
    # endpoint" was not enough: when a stale launcher kept the OLD process
    # alive, the check passed and the updater announced success while the new
    # version had never booted. Ask the plugin first (it knows its own build),
    # then fall back to the install directory in the owner's command line.
    try {
        $status = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/dsh-auto-update/api/status" -TimeoutSec 5 -ErrorAction Stop
        if ($status.currentVersion) { return [string]$status.currentVersion }
    } catch { }
    foreach ($owner in (Get-PortOwners $Port)) {
        try {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
            if ($proc -and $proc.CommandLine -and ($proc.CommandLine -match 'dsh-install-([0-9][^\\/"]*)')) {
                return [string]$Matches[1]
            }
        } catch { }
    }
    return ''
}

function Wait-WebHealthy([int]$TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $started = Get-Date
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 4 -ErrorAction Stop
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                Write-Log "health check OK (HTTP $($response.StatusCode) from $HealthUrl)"
                return $true
            }
        } catch {
            # Host still booting, or this build moved the probe endpoint. Once it
            # has had 20 s of grace, an accepting port is good enough: the real
            # success signal is 'the new version serves HTTP again'.
            $elapsed = ((Get-Date) - $started).TotalSeconds
            if ($elapsed -gt 20 -and (Test-PortOpen $Port)) {
                Write-Log "health probe endpoint unavailable, but port $Port accepts connections after $([int]$elapsed)s"
                return $true
            }
        }
        Start-Sleep -Seconds 2
    }
    Write-Log "health check FAILED after $TimeoutSeconds s"
    return $false
}

# The host can only be restarted by a process OUTSIDE its job tree. This script
# starts as a child of the web host (the plugin spawns it), so killing the host
# can abort it mid-restart - the exact failure behind every truncated restart
# helper on this machine. Win32_Process.Create reparents the child to WmiPrvSE,
# which no job object covers, so stage 2 always survives to start the new host.
function Start-Stage2 {
    # Same reason as the plugin side: powershell.exe -File silently drops empty
    # arguments, so an unset -LaunchCmd killed stage 2 before it could start
    # anything. Hand the parameters over as a file instead.
    $stage2File = Join-Path $StateDir 'stage2-args.json'
    $payload = [ordered]@{
        mode         = 'restart'
        stateDir     = $StateDir
        launcherDir  = $LauncherDir
        launchCmd    = $LaunchCmd
        port         = $Port
        version      = $Version
        currentRoot  = $CurrentRoot
        targetRoot   = $TargetRoot
        registry     = $Registry
        bootLog      = $BootLog
        stage2Reason = $(if ($Stage2Reason) { $Stage2Reason } else { "mode=$Mode version=$Version" })
    }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($stage2File, ($payload | ConvertTo-Json -Depth 4), $utf8)
    $commandLine = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -ArgsFile "{1}"' -f $PSCommandPath, $stage2File
    Write-Log 'handing the restart to a detached stage-2 process'
    try {
        $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine }
        if ($created.ReturnValue -ne 0) { throw "Win32_Process.Create returned $($created.ReturnValue)" }
        Write-Log "stage-2 started as pid $($created.ProcessId)"
        return $true
    } catch {
        Write-Log "WARNING: detached handoff failed ($($_.Exception.Message)); falling back to an in-process restart"
        return $false
    }
}

# The launcher appends to $BootLog, so the reason a new version refused to boot
# is in there. Surface the first error line: without it the card can only say
# "did not come up healthy", which is exactly how the first 0.2.1-rc.2 attempt
# ended up opaque (start-web.cmd truncated the log back then).
function Get-BootFailureHint {
    if (-not $BootLog -or -not (Test-Path $BootLog)) { return '' }
    $tail = @(Get-Content -Path $BootLog -Tail 80 -Encoding UTF8 -ErrorAction SilentlyContinue)
    if (-not $tail.Count) { return '' }
    $line = $tail | Where-Object { $_ -match 'Error:|error:|ERROR:|StartupError|failed:' } | Select-Object -First 1
    if (-not $line) { $line = $tail | Where-Object { $_.Trim() } | Select-Object -Last 1 }
    if (-not $line) { return '' }
    $line = $line.Trim()
    if ($line.Length -gt 300) { $line = $line.Substring(0, 300) }
    Write-Log "boot failure hint: $line"
    return $line
}

# Stop, start, and verify. On an unhealthy host, restore the previous pointer,
# restart again, and record which of the two outcomes happened.
function Restart-And-Verify {
    Stop-WebHost | Out-Null
    Start-WebHost
    if (Wait-WebHealthy 150) {
        $running = Get-RunningVersion
        if ($running -and ($running -ne $Version)) {
            Write-Log "health check passed but the host still runs v$running (expected v$Version) - counting this as a failed restart"
        } else {
            Write-Result 'ok' "healthy on v$Version ($(Get-Pointer))"
            return $true
        }
    }

    $hint = Get-BootFailureHint
    $suffix = ''
    if ($hint) { $suffix = ". Cause: $hint" }

    $restore = ''
    if (Test-Path $PreviousPointer) { $restore = (Get-Content $PreviousPointer -Raw).Trim() }
    if (-not $restore) {
        Write-Result 'failed' "v$Version did not become healthy and no previous install was recorded$suffix"
        return $false
    }
    if (-not (Test-Path (Get-WebBin $restore))) {
        Write-Result 'failed' "v$Version did not become healthy and the previous install is gone: $restore$suffix"
        return $false
    }

    Write-Log "rolling back to $restore"
    Set-Pointer $restore
    Stop-WebHost | Out-Null
    Start-WebHost
    if (Wait-WebHealthy 150) {
        $back = Get-RunningVersion
        if ($back) {
            Write-Result 'rolled-back' "v$Version did not come up healthy; restored $restore (running v$back)$suffix"
        } else {
            Write-Result 'rolled-back' "v$Version did not come up healthy; restored $restore$suffix"
        }
        Write-Log 'rollback completed'
        return $false
    }
    Write-Result 'failed' "v$Version unhealthy and the rollback to $restore also failed"
    return $false
}

function Install-VersionSideBySide([string]$Root, [string]$Wanted) {
    $existing = Get-InstalledVersion $Root
    if ($existing -eq $Wanted) {
        Write-Log "reusing existing install $Root (v$existing)"
        return $true
    }
    if (Test-Path $Root) {
        Write-Log "removing incomplete install $Root (found v$existing)"
        Remove-Item -Path $Root -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Force -Path $Root | Out-Null
    $manifest = [ordered]@{ dependencies = [ordered]@{ '@deepseek-ai/dsh' = $Wanted } }
    ($manifest | ConvertTo-Json -Depth 4) | Set-Content -Path (Join-Path $Root 'package.json') -Encoding ASCII
    Write-Log "installing @deepseek-ai/dsh@$Wanted into $Root (this can take several minutes)"
    $npmArguments = @('install', '--no-audit', '--no-fund', '--no-progress', '--loglevel=error')
    if ($Registry) {
        $npmArguments += @('--registry', $Registry)
        Write-Log "npm registry: $Registry"
    }
    Push-Location $Root
    try {
        & npm.cmd @npmArguments 2>&1 | Out-File -Append -FilePath $LogFile -Encoding UTF8
    } finally {
        Pop-Location
    }
    $code = $LASTEXITCODE
    Write-Log "npm exit code: $code"
    if ($code -ne 0) { throw "npm install failed with exit code $code" }
    $installed = Get-InstalledVersion $Root
    if ($installed -ne $Wanted) { throw "installed version mismatch: expected $Wanted, found $installed" }
    return $true
}

function Test-BootComposition([string]$Root) {
    $bin = Get-WebBin $Root
    if (-not (Test-Path $bin)) { throw "bin.js missing in $Root" }
    $previousHome = $env:DSH_HOME
    if (-not $env:DSH_HOME) { $env:DSH_HOME = Join-Path $env:USERPROFILE 'Documents\Codex\2026-08-14\w\dsh-home' }
    Write-Log "smoke test: $bin --profile web --dump-config"
    $output = & node.exe $bin --profile web --dump-config 2>&1
    $code = $LASTEXITCODE
    $text = ($output | Out-String)
    if ($code -ne 0) {
        $tail = ($text -split "`n" | Select-Object -Last 12) -join "`n"
        throw "dump-config exited $code. Tail: $tail"
    }
    if ($text.Length -lt 500) { throw "dump-config output looks empty ($($text.Length) chars)" }
    Write-Log "smoke test OK ($($text.Length) chars of composed config)"
    $env:DSH_HOME = $previousHome
    return $true
}

function Set-Pointer([string]$RootOrVersion) {
    # Only the version tag goes into the launcher pointer: cmd.exe reads this
    # file in the OEM code page, and this account's home path is non-ASCII, so
    # a full path would come back as mojibake. start-web.cmd rebuilds
    # <base>\dsh-install-<tag> itself.
    $tag = $RootOrVersion.Trim()
    $tag = $tag.TrimEnd('\')
    if ($tag -match '\\dsh-install-(.+)$') { $tag = $Matches[1] }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($PointerFile, $tag, $utf8NoBom)
    Write-Log "launcher pointer -> version tag '$tag'"
}

function Get-PointerTag() {
    if (-not (Test-Path $PointerFile)) { return '' }
    $first = Get-Content -Path $PointerFile -TotalCount 1 -Encoding UTF8 -ErrorAction SilentlyContinue
    if (-not $first) { return '' }
    return $first.Trim()
}

function Get-Pointer() {
    $tag = Get-PointerTag
    if (-not $tag) { return '' }
    if ($tag -match '^[A-Za-z]:\\') { return $tag }   # tolerate a legacy full-path pointer
    return (Join-Path $InstallBase ('dsh-install-' + $tag))
}

# Manual runs may omit -CurrentRoot; the launcher pointer already knows it.
if (-not $CurrentRoot) { $CurrentRoot = Get-Pointer }

# ---------------------------------------------------------------------------

Write-Log '====================================================='
Write-Log "mode=$Mode version=$Version dryRun=$($DryRun.IsPresent) pid=$PID"
Write-Log "state=$StateDir launcher=$LauncherDir"

$lockStale = $true
if ($Mode -ne 'restart') {
    if (Test-Path $LockFile) {
        try {
            $lockAge = (Get-Date) - (Get-Item $LockFile).LastWriteTime
            if ($lockAge.TotalMinutes -lt 120) {
                $lockStale = $false
                Write-Log "another update holds the lock (age $([int]$lockAge.TotalMinutes) min); exiting"
                exit 3
            }
        } catch { }
    }
    Set-Content -Path $LockFile -Value ([string]$PID) -Encoding ASCII
}

$newRoot = ''
try {
    # A restart that cannot be launched would strand the profile on a version
    # nobody verified, so refuse before the pointer moves.
    if (-not $DryRun.IsPresent) {
        if (-not $LaunchCmd) {
            throw 'no restart command configured: pass -LaunchCmd <script> or set DSH_AUTO_UPDATE_LAUNCH_CMD'
        }
        if (-not (Test-Path $LaunchCmd)) { throw "restart command not found: $LaunchCmd" }
    }
    if ($Mode -eq 'restart') {
        # Stage 2. The launcher pointer has already been repointed and the parent
        # process is gone by the time this runs, so nothing here can be aborted by
        # the host dying - that is the whole reason this mode exists.
        Write-Log "stage 2: restarting the web host ($Stage2Reason)"
        if (Restart-And-Verify) {
            Write-Result 'ok' "now running v$Version from $(Get-Pointer)"
            Write-Log 'update completed'
            exit 0
        }
        Write-Log 'stage 2 finished without a healthy host'
        exit 2
    }

    if ($Mode -eq 'apply') {
        if (-not $Version) { throw 'apply needs -Version' }
        if (-not (Test-Path (Get-WebBin $CurrentRoot))) { throw "current root has no dsh install: $CurrentRoot" }

        $installBase = Split-Path $CurrentRoot -Parent
        $newRoot = Join-Path $installBase ("dsh-install-" + $Version)
        Write-Log "target root: $newRoot"

        if ($DryRun.IsPresent) {
            # A dry run must not touch disk or network. -StageOnly is the real
            # "install and smoke test, but do not switch" mode.
            Write-Log 'dry run: nothing installed, pointer untouched, no restart'
            Write-Result 'dry-run' "would install v$Version into $newRoot, smoke test it, repoint the launcher and restart"
            exit 0
        }

        Install-VersionSideBySide $newRoot $Version | Out-Null
        Test-BootComposition $newRoot | Out-Null

        if ($StageOnly.IsPresent) {
            Write-Log 'stage only: installed and smoke tested; pointer untouched'
            Write-Result 'staged' "v$Version installed at $newRoot and passed the boot smoke test; not activated"
            exit 0
        }

        $oldPointer = Get-Pointer
        if ($oldPointer) {
            Set-Content -Path $PreviousPointer -Value $oldPointer -Encoding ASCII
            Write-Log "recorded previous root: $oldPointer"
        }
        Set-Pointer $newRoot
        Write-Result 'pending' "v$Version installed; the host is restarting (this page reconnects shortly)"

        if (-not (Start-Stage2)) {
            if (Restart-And-Verify) {
                Write-Result 'ok' "now running v$Version from $newRoot"
                exit 0
            }
            exit 2
        }
        exit 0
    }

    if ($Mode -eq 'rollback') {
        if (-not $TargetRoot) { throw 'rollback needs -TargetRoot' }
        if (-not (Test-Path (Get-WebBin $TargetRoot))) { throw "target root has no dsh install: $TargetRoot" }
        Test-BootComposition $TargetRoot | Out-Null
        if ($DryRun.IsPresent) {
            Write-Result 'dry-run' "would roll back to $TargetRoot; pointer untouched"
            exit 0
        }
        $currentPointer = Get-Pointer
        if ($currentPointer) { Set-Content -Path $PreviousPointer -Value $currentPointer -Encoding ASCII }
        Set-Pointer $TargetRoot
        Write-Result 'pending' "rolling back to $TargetRoot; the host is restarting (this page reconnects shortly)"
        if (-not (Start-Stage2)) {
            if (Restart-And-Verify) {
                Write-Result 'rolled-back' "now running from $TargetRoot"
                exit 0
            }
            exit 2
        }
        exit 0
    }
} catch {
    $message = $_.Exception.Message
    Write-Log "ERROR: $message"
    if ($_.ScriptStackTrace) { Write-Log ($_.ScriptStackTrace -replace "`r?`n", ' <- ') }
    # Anything thrown before the pointer swap leaves the running host untouched,
    # and after the swap Restart-And-Verify owns recovery. Do not restart the
    # host from here: that is the self-kill trap this script exists to avoid.
    Write-Result 'failed' ("{0} failed: {1}" -f $Mode, $message)
    exit 1
} finally {
    Remove-Item -Path $LockFile -Force -ErrorAction SilentlyContinue
    Write-Log '====================================================='
}
