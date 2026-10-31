param(
    [int]$Minutes = 8,
    [string]$LogPath = (Join-Path $env:TEMP "usb-watch.log")
)
$log = $LogPath
"started $(Get-Date -Format 'HH:mm:ss')" | Out-File -FilePath $log -Encoding utf8

function Snapshot {
    $items = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
        Where-Object { $_.InstanceId -like "USB*" }
    $map = @{}
    foreach ($d in $items) {
        $map[$d.InstanceId] = "$($d.Status)|$($d.FriendlyName)"
    }
    return $map
}

$prev = Snapshot
$end = (Get-Date).AddMinutes($Minutes)
while ((Get-Date) -lt $end) {
    Start-Sleep -Seconds 2
    $now = Snapshot
    $stamp = Get-Date -Format 'HH:mm:ss'
    foreach ($k in $now.Keys) {
        if (-not $prev.ContainsKey($k)) {
            "$stamp ADDED   $k  =>  $($now[$k])" | Out-File -FilePath $log -Append -Encoding utf8
        } elseif ($prev[$k] -ne $now[$k]) {
            "$stamp CHANGED $k  =>  $($now[$k])  (was $($prev[$k]))" | Out-File -FilePath $log -Append -Encoding utf8
        }
    }
    foreach ($k in $prev.Keys) {
        if (-not $now.ContainsKey($k)) {
            "$stamp REMOVED $k  (was $($prev[$k]))" | Out-File -FilePath $log -Append -Encoding utf8
        }
    }
    $prev = $now
}
"stopped $(Get-Date -Format 'HH:mm:ss')" | Out-File -FilePath $log -Append -Encoding utf8
