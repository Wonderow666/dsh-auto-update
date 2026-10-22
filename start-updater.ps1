# dsh-auto-update - hand the updater over to a process the host cannot kill
#
# The plugin used to spawn apply-update.ps1 with node's `detached: true`. On this
# machine that child never runs at all: a flag matrix (detached / windowsHide /
# inherited stdio / -WindowStyle Hidden) showed every DETACHED_PROCESS variant
# producing a dead child with no output, while the same command line spawned
# normally runs fine. And a child spawned normally is still inside the web host's
# job object, so the updater would be killed by the very restart it performs.
#
# So: this script runs as an ordinary child (that part works), asks WMI to create
# the real updater outside the host's process tree, prints the pid it got, and
# exits. The plugin treats "started pid=<n>" plus the updater's own first log line
# as proof that work actually began.
#
# ASCII-only, Windows PowerShell 5.1 compatible.

param(
    [Parameter(Mandatory = $true)][string]$ArgsFile,
    [Parameter(Mandatory = $true)][string]$UpdaterScript,
    [Parameter(Mandatory = $false)][string]$Port = '3080'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $ArgsFile)) {
    Write-Output "FAIL args file missing: $ArgsFile"
    exit 1
}
if (-not (Test-Path -LiteralPath $UpdaterScript)) {
    Write-Output "FAIL updater script missing: $UpdaterScript"
    exit 1
}

$commandLine = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -ArgsFile "{1}"' -f $UpdaterScript, $ArgsFile

try {
    $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine } -ErrorAction Stop
} catch {
    Write-Output "FAIL Win32_Process.Create threw: $($_.Exception.Message)"
    exit 1
}
if ($created.ReturnValue -ne 0) {
    Write-Output "FAIL Win32_Process.Create returned $($created.ReturnValue)"
    exit 1
}

Write-Output "started pid=$($created.ProcessId)"
