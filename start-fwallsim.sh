#!/bin/bash
# Starts FWallSim in the background and opens it in your browser (macOS / Linux).
# Usage (from this folder):  ./start-fwallsim.sh
cd "$(dirname "$0")" || exit 1
PORT=5173
PID_FILE=".fwallsim.pid"
LOG_FILE="fwallsim.log"

if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "FWallSim is already running at http://localhost:$PORT"
  open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it (brew install node, or https://nodejs.org) and run this script again."
  exit 1
fi

# First run (or after copying from another computer): install the dependencies.
if [ ! -d node_modules ]; then
  echo "First start: installing dependencies (one time, about a minute)..."
  npm install || { echo "npm install failed."; exit 1; }
fi

echo "Starting FWallSim..."
nohup npx vite --port $PORT --strictPort > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

# Wait until the server answers (up to 30 seconds).
for _ in $(seq 1 60); do
  sleep 0.5
  if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "FWallSim is running at http://localhost:$PORT"
    echo "Login: admin with an empty password (you will be asked to set a new one)."
    echo "To stop it, run: ./stop-fwallsim.sh"
    exit 0
  fi
done
echo "FWallSim did not start. See $LOG_FILE for details."
exit 1
