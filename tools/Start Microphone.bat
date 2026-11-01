@echo off
title JATAYU microphone listener
echo Keep this window open. Use the Microphone button on the /csi page.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-audio.ps1" %*
pause
