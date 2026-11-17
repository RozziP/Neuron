param([ValidateRange(1,65535)][int]$VendorId, [ValidateRange(1,65535)][int]$ProductId)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$neuronResult = @{ windowsStatus='unavailable'; softwareStatus='not-supported'; windows=@(); software=@() }
$neuronMatch = 'VID_{0:X4}&PID_{1:X4}(?:&|\\|$)' -f $VendorId,$ProductId
try {
    $neuronDevices = @(Get-PnpDevice -PresentOnly | Where-Object InstanceId -match $neuronMatch | Select-Object -First 32)
    $neuronResult.windowsStatus = if ($neuronDevices.Count) { 'complete' } else { 'unavailable' }
    foreach ($neuronDevice in $neuronDevices) {
        try {
            $neuronProperties = @{}
            Get-PnpDeviceProperty -InstanceId $neuronDevice.InstanceId | ForEach-Object { $neuronProperties[$_.KeyName] = $_.Data }
            # Deliberately exclude instance IDs, serials, location, container IDs and paths.
            $neuronResult.windows += @{
                deviceClass=[string]$neuronDevice.Class
                description=[string]$neuronProperties['DEVPKEY_Device_DeviceDesc']
                busDescription=[string]$neuronProperties['DEVPKEY_Device_BusReportedDeviceDesc']
                manufacturer=[string]$neuronProperties['DEVPKEY_Device_Manufacturer']
                driverProvider=[string]$neuronProperties['DEVPKEY_Device_DriverProvider']
                driverVersion=[string]$neuronProperties['DEVPKEY_Device_DriverVersion']
            }
        } catch { $neuronResult.windowsStatus = 'partial' }
    }
} catch { }

# A narrow adapter for the Compx/Redragon configuration format. Do not upload an
# installed-program inventory or arbitrary configuration files. Add other formats
# only with a verified ID-matching rule and an explicit field allowlist.
if ($VendorId -eq 0x3554) {
    try {
        $neuronResult.softwareStatus = 'complete'
        $neuronApps = @(Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -match '^Redragon .{1,60}Mouse$' -and $_.InstallLocation } | Select-Object -First 16)
        foreach ($neuronApp in $neuronApps) {
            $neuronInstall = [IO.Path]::GetFullPath($neuronApp.InstallLocation).TrimEnd('\') + '\'
            $neuronRoots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }
            if (!($neuronRoots | Where-Object { $neuronInstall.StartsWith($_.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) })) { continue }
            foreach ($neuronRelative in @('Sys64\usersetting\Config.ini','Sys32\usersetting\Config.ini')) {
                $neuronConfig = Join-Path $neuronInstall $neuronRelative
                if (!(Test-Path -LiteralPath $neuronConfig -PathType Leaf) -or (Get-Item -LiteralPath $neuronConfig).Length -gt 65536) { continue }
                $neuronValues = @{}
                foreach ($neuronLine in Get-Content -LiteralPath $neuronConfig) {
                    if ($neuronLine -match '^(VID|USB_PID|Wireless_PID|Wireless2_PID|Wireless4_PID|Wireless8_PID|MID)\s*=\s*(.*?)\s*$') { $neuronValues[$Matches[1]]=$Matches[2] }
                }
                try {
                    $neuronVid = [Convert]::ToInt32([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($neuronValues.VID)),16)
                    if ($neuronVid -ne $VendorId) { continue }
                    $neuronPids = @('USB_PID','Wireless_PID','Wireless2_PID','Wireless4_PID','Wireless8_PID') | ForEach-Object {
                        if ($neuronValues[$_]) { [Convert]::ToInt32([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($neuronValues[$_])),16) }
                    }
                    if ($ProductId -notin $neuronPids) { continue }
                    $neuronMid = 0
                    $neuronConfiguredMid = if ([int]::TryParse($neuronValues.MID,[ref]$neuronMid)) { $neuronMid } else { $null }
                    $neuronResult.software += @{ source='installed-driver-config'; name=[string]$neuronApp.DisplayName; version=[string]$neuronApp.DisplayVersion; vendorId=$VendorId; productId=$ProductId; configuredModelId=$neuronConfiguredMid }
                    break
                } catch { continue }
            }
        }
    } catch { $neuronResult.softwareStatus = 'unavailable' }
}
$neuronResult | ConvertTo-Json -Depth 6 -Compress
