#!/usr/bin/env bash
# Records one labelled CSI trial on the Pi, restarts the backend and prints the analysis.
# Keeps running if the SSH connection drops.
#   bash ~/JATAYU/tools/record_trial.sh crowded_room
#   bash ~/JATAYU/tools/record_trial.sh crowded_room 190 "about 150 people"
set -u
label="${1:?usage: record_trial.sh <label> [seconds] [notes]}"
seconds="${2:-190}"
notes="${3:-}"
backend="$HOME/JATAYU/backend"
log="$HOME/JATAYU/logs/trial_${label}.log"

if [ -z "${JATAYU_TRIAL_DETACHED:-}" ]; then
  JATAYU_TRIAL_DETACHED=1 setsid nohup bash "$0" "$@" > "$log" 2>&1 &
  worker=$!
  tail --pid="$worker" -n +1 -f "$log" 2>/dev/null | tr '\r' '\n'
  exit 0
fi

restart() { sudo systemctl start jatayu; echo "Dashboard is back on port 8000."; }
trap restart EXIT
cd "$backend" || exit 1
before=$(ls -t recordings/*.jsonl 2>/dev/null | head -1)
sudo systemctl stop jatayu
echo "Recording '$label' for $seconds s. The ESP32 restarts first: data begins after about 10 s."
.venv/bin/python capture_raw.py --label "$label" --duration "$seconds" --distance-m 2 --notes "$notes"
file=$(ls -t recordings/*.jsonl | head -1)
if [ "$file" = "$before" ]; then
  echo "No new recording was saved."
  exit 1
fi
echo "Saved: $file"
.venv/bin/python analyze_recording.py "$file"
