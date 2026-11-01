<#
.SYNOPSIS
  Start the JATAYU microphone listener on this laptop. Installs what it needs on first run.

.EXAMPLE
  .\tools\start-audio.ps1
  .\tools\start-audio.ps1 -Backend http://192.168.137.10:8000 -Device 1
  .\tools\start-audio.ps1 -ListDevices
#>
param(
    [string]$Backend = 'http://192.168.137.10:8000',
    [int]$Device = -1,
    [switch]$ListDevices
)

$ErrorActionPreference = 'Stop'
$audio = Join-Path (Split-Path -Parent $PSScriptRoot) 'audio'
$venv = Join-Path $audio '.venv'
$python = Join-Path $venv 'Scripts\python.exe'
$models = Join-Path $audio 'models'

if (-not (Test-Path $python)) {
    # The audio packages need Python 3.11, whichever Python is the default.
    Write-Host 'Setting up the audio environment (first run only)...'
    & py -3.11 -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 is required.' }
    & $python -m pip install -q -r (Join-Path $audio 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Could not install the audio packages.' }
}

New-Item -ItemType Directory -Force $models | Out-Null
$files = @{
    'yamnet.tflite'         = 'https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite'
    'yamnet_class_map.csv'  = 'https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv'
}
foreach ($name in $files.Keys) {
    $target = Join-Path $models $name
    if (-not (Test-Path $target)) {
        Write-Host "Downloading $name ..."
        Invoke-WebRequest -UseBasicParsing $files[$name] -OutFile $target
    }
}
$speech = Join-Path $models 'vosk-model-small-en-us-0.15'
if (-not (Test-Path $speech)) {
    Write-Host 'Downloading the speech model (about 41 MB)...'
    $zip = Join-Path $models 'speech.zip'
    Invoke-WebRequest -UseBasicParsing 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip' -OutFile $zip
    Expand-Archive $zip -DestinationPath $models
    Remove-Item $zip
}

$arguments = @((Join-Path $audio 'listener.py'), '--backend', $Backend)
if ($ListDevices) { $arguments += '--list-devices' }
if ($Device -ge 0) { $arguments += @('--device', "$Device") }
if ($ListDevices) { & $python @arguments; return }
# Restart after a crash, so the website's button keeps working. Ctrl+C stops it.
while ($true) {
    & $python @arguments
    Write-Host 'Listener stopped. Restarting in 5 seconds. Press Ctrl+C to quit.'
    Start-Sleep -Seconds 5
}
