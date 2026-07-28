[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$WolfyArgs
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = $env:WOLFYSTOCK_BOOTSTRAP_PYTHON
$pythonArgs = @()
$isolationArgs = @('-E', '-s', '-B')
if (-not $python) {
    $python = (Get-Command python3.11 -ErrorAction SilentlyContinue).Source
}
if (-not $python) {
    $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        $python = $pyLauncher.Source
        $pythonArgs = @('-3.11')
    }
}
if (-not $python) {
    Write-Error '{"status":"error","reasonCode":"supported_bootstrap_python_missing","message":"CPython 3.11 is required; set WOLFYSTOCK_BOOTSTRAP_PYTHON explicitly."}'
    exit 1
}
$bootstrapProbe = 'import platform,sys; print(platform.python_implementation(), ''CPython'', sys.version_info[0], sys.version_info[1], sep=''|'')'
try {
    $probeOutput = & $python @pythonArgs @isolationArgs -c $bootstrapProbe
    $probeExitCode = $LASTEXITCODE
    $probeOutput = @($probeOutput)
}
catch [System.Management.Automation.CommandNotFoundException] {
    Write-Error '{"status":"error","reasonCode":"bootstrap_python_probe_execution_failed","message":"Bootstrap interpreter probe could not be executed."}'
    exit 1
}
catch [System.Management.Automation.ApplicationFailedException] {
    Write-Error '{"status":"error","reasonCode":"bootstrap_python_probe_execution_failed","message":"Bootstrap interpreter probe could not be executed."}'
    exit 1
}
catch [System.ComponentModel.Win32Exception] {
    Write-Error '{"status":"error","reasonCode":"bootstrap_python_probe_execution_failed","message":"Bootstrap interpreter probe could not be executed."}'
    exit 1
}
if ($probeExitCode -ne 0) {
    Write-Error '{"status":"error","reasonCode":"bootstrap_python_probe_execution_failed","message":"Bootstrap interpreter probe could not be executed."}'
    exit 1
}
if ($probeOutput.Count -ne 1) {
    Write-Error '{"status":"error","reasonCode":"bootstrap_python_probe_invalid","message":"Bootstrap interpreter probe returned an invalid result."}'
    exit 1
}
$probeFields = ([string]$probeOutput[0]).Split('|')
if (
    $probeFields.Count -ne 4 -or
    $probeFields[0].Length -eq 0 -or
    $probeFields[1] -cne 'CPython' -or
    $probeFields[2] -notmatch '^[0-9]+$' -or
    $probeFields[3] -notmatch '^[0-9]+$'
) {
    Write-Error '{"status":"error","reasonCode":"bootstrap_python_probe_invalid","message":"Bootstrap interpreter probe returned an invalid result."}'
    exit 1
}
if ($probeFields[0] -cne 'CPython' -or $probeFields[2] -ne '3' -or $probeFields[3] -ne '11') {
    Write-Error '{"status":"error","reasonCode":"unsupported_bootstrap_python","message":"Bootstrap interpreter must be CPython 3.11."}'
    exit 1
}
$entrypoint = Join-Path $root 'scripts/wolfy.py'
& $python @pythonArgs @isolationArgs $entrypoint @WolfyArgs
exit $LASTEXITCODE
