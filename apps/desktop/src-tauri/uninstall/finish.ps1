param([Parameter(Mandatory=$true)][string]$PlanPath)
$ErrorActionPreference = 'Stop'
$committed = $false
$succeeded = $false
$plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
$work = [System.IO.Path]::GetDirectoryName($PlanPath)
function Shell-Path([string]$path) {
    if ($path.StartsWith('\\?\UNC\')) { return '\\' + $path.Substring(8) }
    if ($path.StartsWith('\\?\')) { return $path.Substring(4) }
    return $path
}
try {
    $parent = Get-Process -Id $plan.parentPid -ErrorAction Stop
    Set-Content -LiteralPath (Join-Path $work 'ready') -Value 'ready'
    while ($true) {
        if (Test-Path -LiteralPath (Join-Path $work 'cancel')) { exit 0 }
        if (Test-Path -LiteralPath (Join-Path $work 'commit')) { break }
        if ($parent.HasExited) { exit 0 }
        Start-Sleep -Seconds 1
    }
    $committed = $true
    if (!$parent.WaitForExit(60000)) { throw 'Enderlink did not exit. No application files were removed.' }
    if ($plan.method -ne 'windows_nsis') { throw 'Unknown uninstall method.' }
    # The installer owns shortcuts, registration and installed resource files.
    # /P is Tauri's passive mode: progress and errors stay visible.
    try {
        $uninstaller = Start-Process -FilePath (Shell-Path $plan.target) -ArgumentList '/P' -PassThru
    } catch {
        if ($_.Exception.NativeErrorCode -ne 740) { throw }
        $uninstaller = Start-Process -FilePath (Shell-Path $plan.target) -ArgumentList '/P' -Verb RunAs -PassThru
    }
    $uninstaller.WaitForExit()
    if ($uninstaller.ExitCode -ne 0 -and $uninstaller.ExitCode -ne 3010) {
        throw "The Windows uninstaller did not finish (exit $($uninstaller.ExitCode))."
    }
    # NSIS can hand off to a temporary copy of itself. Do not report success
    # merely because its first process exited.
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if (!(Test-Path -LiteralPath $plan.application)) { break }
        Start-Sleep -Seconds 1
    }
    if (Test-Path -LiteralPath $plan.application) {
        throw 'The Windows uninstaller left Enderlink installed.'
    }
    foreach ($ownedPath in $plan.roots) {
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            try {
                if (Test-Path -LiteralPath $ownedPath) {
                    Remove-Item -LiteralPath $ownedPath -Recurse -Force
                }
                break
            } catch {
                if ($attempt -eq 29) { throw }
                Start-Sleep -Milliseconds 500
            }
        }
    }
    $succeeded = $true
} catch {
    $_ | Out-String | Add-Content -LiteralPath (Join-Path $work 'uninstall.log')
    try {
        $popup = New-Object -ComObject WScript.Shell
        $null = $popup.Popup("Enderlink could not finish uninstalling. Your saved-worlds folder is unaffected. See $work\uninstall.log for details.", 0, 'Enderlink uninstall', 48)
    } catch {}
    exit 1
} finally {
    if (!$committed -or $succeeded) {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}
