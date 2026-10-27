#!/bin/bash
# Stops FWallSim started by start-fwallsim.sh (or anything serving it on port 5173), macOS / Linux.
# Usage (from this folder):  ./stop-fwallsim.sh
cd "$(dirname "$0")" || exit 1
PORT=5173
PID_FILE=".fwallsim.pid"
stopped=0

# 1. The process we started (npx and the vite process under it).
if [ -f "$PID_FILE" ]; then
  pid=$(cat "$PID_FILE")
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    pkill -P "$pid" 2>/dev/null
    kill "$pid" 2>/dev/null
    stopped=1
  fi
  rm -f "$PID_FILE"
fi

# 2. Any node process still listening on the FWallSim port (e.g. started with "npm run dev").
for pid in $(lsof -nP -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null); do
  if ps -p "$pid" -o comm= | grep -q node; then
    kill "$pid" 2>/dev/null
    stopped=1
  fi
done

if [ $stopped -eq 1 ]; then echo "FWallSim stopped."; else echo "FWallSim was not running."; fi
