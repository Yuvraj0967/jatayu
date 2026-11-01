#!/usr/bin/env bash
# Builds the console, copies the current code to the Pi, restarts the backend and checks it.
# Run from Git Bash:  bash tools/deploy-pi.sh [pi-address]
set -eu
pi="${1:-192.168.137.10}"
cd "$(dirname "$0")/.."
ssh -o BatchMode=yes -o ConnectTimeout=8 "pi@$pi" true || { echo "Cannot reach the Pi at $pi. Is it on the hotspot?"; exit 1; }
(cd console && npm run build >/dev/null)
tar --exclude=__pycache__ --exclude='*.db' --exclude='*.pyc' --exclude=.venv --exclude='calibration*.json' --exclude=recordings \
    -cf - backend dashboard console/dist tools/record_trial.sh tools/jatayu.service | ssh "pi@$pi" 'cd ~/JATAYU && rm -rf console/dist && tar -xf - && sed -i "s/\r$//" tools/record_trial.sh'
ssh "pi@$pi" 'cd ~/JATAYU/backend && .venv/bin/python -m pip install -q -r requirements.txt && sudo -n systemctl restart jatayu && sleep 25 && systemctl is-active jatayu && for p in / /csi /simple/ /api/status; do curl -s -m 5 -o /dev/null -w "$p %{http_code}\n" "http://127.0.0.1:8000$p"; done; lsusb | grep -iE "303a|1a86" || echo "A board is missing from USB"'
echo "Deployed. Open http://$pi:8000/csi"
