$ErrorActionPreference = 'SilentlyContinue'
$entries = @(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object { $_.DisplayName } | Select-Object DisplayName,InstallLocation,DisplayIcon,Publisher,PSChildName)
$steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam').SteamPath
$gog = @(Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\GOG.com\Games\*','HKLM:\SOFTWARE\GOG.com\Games\*' | Select-Object gameName,path,exe)
$drives = @(Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -match '^[A-Z]:\\$' } | Select-Object -ExpandProperty Root)
@{ entries=$entries; steam=$steam; gog=$gog; drives=$drives } | ConvertTo-Json -Depth 5 -Compress
