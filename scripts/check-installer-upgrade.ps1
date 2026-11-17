param([string]$FromVersion = '0.1.4', [string]$ToVersion = '0.1.5')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$artifactRoot = Join-Path $projectRoot 'artifacts'
$testRoot = Join-Path $artifactRoot ('installer-upgrade-' + [guid]::NewGuid().ToString('N'))
$installRoot = Join-Path $testRoot 'Neuron'
$resultPath = Join-Path $artifactRoot 'installer-upgrade-result.json'
function Find-NeuronInstall {
  foreach ($root in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    if (Test-Path -LiteralPath $root) {
      Get-ChildItem -LiteralPath $root | ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } | Where-Object { $_.DisplayName -match '^Neuron(?:\s|$)' }
    }
  }
}
function Run-Installer($file, $arguments) {
  $process = Start-Process -FilePath $file -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw "Installer exited with $($process.ExitCode)." }
}
if (@(Find-NeuronInstall).Count -ne 0) { throw 'This isolated check requires no registered Neuron installation.' }
if (Test-Path -LiteralPath $installRoot) { throw 'Test installation directory already exists.' }
# The bundled installer's process detection uses path-scoped PowerShell when available.
& "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "if ((Get-Command Get-CimInstance -ErrorAction SilentlyContinue) -and (Get-ExecutionPolicy -Scope Process) -ne 'Restricted') { exit 0 } else { exit 1 }"
if ($LASTEXITCODE -ne 0) { throw 'Path-scoped installer process detection is unavailable.' }
New-Item -ItemType Directory -Path $testRoot | Out-Null
$profilePath = Join-Path $env:APPDATA 'Neuron\profiles.json'
$dataRoot = Join-Path $env:APPDATA 'Neuron'
$dataPaths = @(Get-ChildItem -LiteralPath $dataRoot -File -ErrorAction SilentlyContinue | Where-Object Extension -EQ '.json' | Select-Object -ExpandProperty FullName) + @(Get-ChildItem (Join-Path $dataRoot 'backups') -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
$before = @($dataPaths | ForEach-Object { Get-FileHash -LiteralPath $_ -Algorithm SHA256 })
$shortcuts = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Neuron.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Neuron.lnk'))
$savedShortcuts = @{}
foreach ($shortcut in $shortcuts) { if (Test-Path -LiteralPath $shortcut) { $savedShortcuts[$shortcut] = [IO.File]::ReadAllBytes($shortcut) } }
$portableIds = @(Get-Process Neuron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $projectRoot 'dist\Neuron-win32-x64\Neuron.exe') } | Select-Object -ExpandProperty Id)
$result = @{ ok = $false; from = $FromVersion; to = $ToVersion; installation = $installRoot }
try {
  Run-Installer (Join-Path $projectRoot "dist\release\Neuron-Setup-$FromVersion-x64.exe") "/S /D=$installRoot"
  $old = @(Find-NeuronInstall)
  if ($old.Count -ne 1 -or $old[0].DisplayVersion -ne $FromVersion) { throw 'Old installation was not registered correctly.' }
  $installedExe = Join-Path $installRoot 'Neuron.exe'
  if ((Get-Item -LiteralPath $installedExe).VersionInfo.FileVersion -ne $FromVersion) { throw 'Old executable version mismatch.' }
  # Simulate a user deleting both shortcuts. Only Start should be restored.
  $shell = New-Object -ComObject WScript.Shell
  foreach ($shortcut in $shortcuts) {
    if (Test-Path -LiteralPath $shortcut) {
      if ($shell.CreateShortcut($shortcut).TargetPath -ne $installedExe) { throw 'Unexpected shortcut target; refusing to remove it.' }
      Remove-Item -LiteralPath $shortcut
    }
  }
  # No /D on upgrade: discover the previous location. --updated exercises
  # NSIS's keepShortcuts path, which normally leaves deleted shortcuts missing.
  Run-Installer (Join-Path $projectRoot "dist\release\Neuron-Setup-$ToVersion-x64.exe") '/S --updated'
  $new = @(Find-NeuronInstall)
  if ($new.Count -ne 1 -or $new[0].DisplayVersion -ne $ToVersion -or $new[0].PSChildName -ne $old[0].PSChildName) { throw 'Upgrade did not replace the existing registration.' }
  if ((Get-Item -LiteralPath $installedExe).VersionInfo.FileVersion -ne $ToVersion) { throw 'Upgrade did not reuse the installation directory.' }
  $result.folderReused = $true
  $result.singleRegistration = $true
  foreach ($entry in $before) { if ((Get-FileHash -LiteralPath $entry.Path -Algorithm SHA256).Hash -ne $entry.Hash) { throw 'Saved user data changed during upgrade.' } }
  $result.preservedDataFiles = $before.Count
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($shortcuts[1])
  if ($link.TargetPath -ne $installedExe) { throw 'Start menu shortcut did not point to the upgraded application.' }
  if ($link.WorkingDirectory -ne $installRoot -or $link.Arguments) { throw 'Invalid Start menu shortcut working directory or arguments.' }
  if (Test-Path -LiteralPath $shortcuts[0]) { throw 'Upgrade recreated a deliberately removed desktop shortcut.' }
  $result.startMenuRestored = $true
  $result.desktopPreferencePreserved = $true
  # Also cover a downloaded installer run normally, as Neuron's update link does.
  Remove-Item -LiteralPath $shortcuts[1]
  Run-Installer (Join-Path $projectRoot "dist\release\Neuron-Setup-$ToVersion-x64.exe") '/S'
  if (!(Test-Path -LiteralPath $shortcuts[1]) -or $shell.CreateShortcut($shortcuts[1]).TargetPath -ne $installedExe) { throw 'Manual installer did not restore the Start menu shortcut.' }
  $result.manualInstallStartMenuRestored = $true
  foreach ($entry in $before) { if ((Get-FileHash -LiteralPath $entry.Path -Algorithm SHA256).Hash -ne $entry.Hash) { throw 'Saved user data changed during reinstall.' } }
  $env:NEURON_SMOKE_DIR = Join-Path $testRoot 'smoke'
  foreach ($flag in @('--smoke-test', '--dpi-smoke-test')) {
    Run-Installer $installedExe $flag
  }
  foreach ($file in @('smoke-result.json', 'dpi-smoke-result.json')) {
    $smoke = Get-Content -LiteralPath (Join-Path $env:NEURON_SMOKE_DIR $file) -Raw | ConvertFrom-Json
    if (!$smoke.ok) { throw "Packaged test failed: $file" }
  }
  $result.packagedSmokePassed = $true
  $result.dpiSmokePassed = $true
  foreach ($idValue in $portableIds) { if (!(Get-Process -Id $idValue -ErrorAction SilentlyContinue)) { throw 'Existing portable app was unexpectedly stopped.' } }
  $result.portableAppUninterrupted = $true
  $result.ok = $true
} catch {
  $result.error = $_.Exception.Message
  throw
} finally {
  # Uninstall only our registered test copy, with its checked absolute location.
  $registered = @(Find-NeuronInstall)
  if ($registered.Count -eq 1) {
    $uninstaller = Join-Path $installRoot 'Uninstall Neuron.exe'
    $resolvedTarget = [IO.Path]::GetFullPath($installRoot)
    if (!$resolvedTarget.StartsWith([IO.Path]::GetFullPath($testRoot) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe cleanup location.' }
    if (!$registered[0].UninstallString.StartsWith('"' + $uninstaller + '"', [StringComparison]::OrdinalIgnoreCase)) { throw 'Registered installation is outside the test directory.' }
    Run-Installer $uninstaller "/S /KEEP_APP_DATA _?=$installRoot"
  }
  foreach ($shortcut in $savedShortcuts.Keys) { [IO.File]::WriteAllBytes($shortcut, $savedShortcuts[$shortcut]) }
  $result.cleanupRegistrationRemoved = @(Find-NeuronInstall).Count -eq 0
  $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resultPath
  Remove-Item Env:NEURON_SMOKE_DIR -ErrorAction SilentlyContinue
}
$result | ConvertTo-Json -Depth 5
