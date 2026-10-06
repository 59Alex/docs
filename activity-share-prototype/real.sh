#!/bin/bash
# Реальный прогон без Playwright: обычный Chromium с расширением, фон вкладки как у пользователя.
# Использование: ./real.sh plan-file.json
cd "$(dirname "$0")"; cp "$1" plan.json; rm -f results-real.jsonl
node server.js & SRV=$!
PAC=$(node -e "const s=require(\"fs\").readFileSync(\"pac.js\");console.log(\"data:application/x-ns-proxy-autoconfig;base64,\"+s.toString(\"base64\"))")
rm -rf .profile-real 2>/dev/null; true
DISPLAY=${DISPLAY:-:1} XAUTHORITY=${XAUTHORITY:-/run/user/1000/gdm/Xauthority} ~/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome \
  --user-data-dir=$PWD/.profile-real --no-sandbox --no-first-run --no-default-browser-check --autoplay-policy=no-user-gesture-required \
  --proxy-pac-url="$PAC" --disable-extensions-except=$PWD/ext --load-extension=$PWD/ext --window-size=1280,860 about:blank >chrome.log 2>&1 &
CH=$!
for i in $(seq 1 ${TMO:-900}); do sleep 1; grep -q '"DONE"' results-real.jsonl 2>/dev/null && break; done
kill $CH $SRV 2>/dev/null; wait 2>/dev/null; rm -rf .profile-real 2>/dev/null; true
cp results-real.jsonl "results-$(basename "$1" .json).jsonl" 2>/dev/null
