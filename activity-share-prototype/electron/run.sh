#!/bin/bash
# Прогон прототипа «Connect Активность» на Linux (repos): LiveKit dev-сервер, тестовый сервер, Electron на X-дисплее.
# Использование: ./run.sh plan-quick.json   (переменные: FEATURES=AcceleratedVideoEncoder — аппаратное кодирование VA-API)
# Зависимости: npm i (electron 44.5.1, livekit-client, livekit-server-sdk); livekit-server в PATH или ./livekit-server.
set -u; cd "$(dirname "$0")"
export PATH=/home/aleksandr/.nvm/versions/node/v24.21.0/bin:$PATH
LK=$(command -v livekit-server || echo ./livekit-server)
PLANF=${1:-plan-quick.json}; R=${RUNDIR:-$PWD}; mkdir -p "$R"; OUTF="$R/results-$(basename "$PLANF" .json).jsonl"; rm -f "$OUTF"; export SHOTS=$R/shots
$LK --dev --bind 127.0.0.1 --node-ip 127.0.0.1 > "$R/livekit.log" 2>&1 & LKP=$!
OUT=$OUTF node server.js > "$R/server.log" 2>&1 & SRV=$!
sleep 2
DISPLAY=${DISPLAY:-:1} XAUTHORITY=${XAUTHORITY:-/run/user/1000/gdm/Xauthority} PLAN=$PWD/$PLANF OUT=$OUTF \
  timeout ${TMO:-900} ./node_modules/electron/dist/electron --no-sandbox . > "$R/electron.log" 2>&1
kill $SRV $LKP 2>/dev/null; wait 2>/dev/null
grep -E '"(summary|frame-capture|captureStream-in-page|error|start)"' "$OUTF" | cut -c1-900
