$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
& (Join-Path $PSScriptRoot 'build-native.ps1')
$electronPath = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
if (!(Test-Path -LiteralPath $electronPath)) { throw 'Run npm install, then npm start to install Electron.' }
Start-Process -FilePath $electronPath -ArgumentList ('"' + $projectRoot + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden
