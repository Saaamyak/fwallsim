# Starts FWallSim in the background and opens it in your browser.
# Usage (from this folder):  powershell -ExecutionPolicy Bypass -File .\start-fwallsim.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$port = 5173
$pidFile = Join-Path $root '.fwallsim.pid'
$logFile = Join-Path $root 'fwallsim.log'
Set-Location $root

# Already running?
$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
    Write-Host "FWallSim is already running at http://localhost:$port" -ForegroundColor Yellow
    Start-Process "http://localhost:$port"
    exit 0
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Node.js is not installed. Install it from https://nodejs.org and run this script again.' -ForegroundColor Red
    exit 1
}

# First run: install the dependencies.
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Host 'First start: installing dependencies (one time, about a minute)...'
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { Write-Host 'npm install failed.' -ForegroundColor Red; exit 1 }
}

Write-Host 'Starting FWallSim...'
$proc = Start-Process -FilePath 'cmd.exe' -ArgumentList "/c npx vite --port $port --strictPort > `"$logFile`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden -PassThru
Set-Content -Path $pidFile -Value $proc.Id -Encoding ascii

# Wait until the server answers (up to 30 seconds).
$up = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { $up = $true; break }
}
if ($up) {
    Write-Host "FWallSim is running at http://localhost:$port" -ForegroundColor Green
    Write-Host 'Login: admin with an empty password (you will be asked to set a new one).'
    Write-Host 'To stop it, run: .\stop-fwallsim.ps1'
} else {
    Write-Host "FWallSim did not start. See $logFile for details." -ForegroundColor Red
    exit 1
}
