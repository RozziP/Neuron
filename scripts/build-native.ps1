$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path $compiler)) { throw 'The Windows .NET Framework C# compiler is required.' }
$source = Join-Path $projectRoot 'native\NeuronBridge.cs'
$output = Join-Path $projectRoot 'native\NeuronBridge.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /r:System.Web.Extensions.dll "/out:$output" $source
if ($LASTEXITCODE -ne 0) { throw 'Native bridge compilation failed.' }
$updaterSource = Join-Path $projectRoot 'native\NeuronUpdater.cs'
$updaterOutput = Join-Path $projectRoot 'native\NeuronUpdater.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /r:System.Web.Extensions.dll "/out:$updaterOutput" $updaterSource
if ($LASTEXITCODE -ne 0) { throw 'Native updater compilation failed.' }
