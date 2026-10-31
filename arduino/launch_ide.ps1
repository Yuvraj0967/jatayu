$ErrorActionPreference = 'Stop'
$exe = "C:\Users\Yuvraj Pateria\AppData\Local\Programs\Arduino IDE\Arduino IDE.exe"
$flags = "--in-process-gpu --disable-gpu-sandbox --disable-gpu"

Get-Process -Name "Arduino IDE" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name "arduino-cli" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

$ws = New-Object -ComObject WScript.Shell

$startMenu = "C:\Users\Yuvraj Pateria\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Arduino IDE.lnk"
if (Test-Path $startMenu) {
    $lnk = $ws.CreateShortcut($startMenu)
    $lnk.Arguments = $flags
    $lnk.Save()
    Write-Output "Start Menu shortcut updated with GPU workaround flags."
}

$desktopDir = [Environment]::GetFolderPath('Desktop')
$desktopLnk = Join-Path $desktopDir "Arduino IDE.lnk"
$lnk2 = $ws.CreateShortcut($desktopLnk)
$lnk2.TargetPath = $exe
$lnk2.Arguments = $flags
$lnk2.WorkingDirectory = Split-Path $exe
$lnk2.IconLocation = "$exe,0"
$lnk2.Save()
Write-Output ("Desktop shortcut: " + $desktopLnk)

$sketch = "C:\Users\Yuvraj Pateria\Documents\jatayu\arduino\mega_self_test\mega_self_test.ino"
Start-Process -FilePath $exe -ArgumentList ($flags + ' "' + $sketch + '"')
Start-Sleep -Seconds 25

$p = Get-Process -Name "Arduino IDE" -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle } | Select-Object -First 1
if ($p) {
    Write-Output ("IDE running, window title: " + $p.MainWindowTitle)
} else {
    Write-Output "IDE process did not produce a window."
}
