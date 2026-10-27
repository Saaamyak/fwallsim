# Stops FWallSim started by start-fwallsim.ps1 (or anything serving it on port 5173).
# Usage (from this folder):  powershell -ExecutionPolicy Bypass -File .\stop-fwallsim.ps1
$root = $PSScriptRoot
$port = 5173
$pidFile = Join-Path $root '.fwallsim.pid'
$stopped = $false

# 1. The process tree we started.
if (Test-Path $pidFile) {
    $id = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($id -and (Get-Process -Id $id -ErrorAction SilentlyContinue)) {
        & taskkill.exe /PID $id /T /F | Out-Null
        $stopped = $true
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

# 2. Anything still listening on the FWallSim port (e.g. started with "npm run dev").
$conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
    $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'node') {
        & taskkill.exe /PID $c.OwningProcess /T /F | Out-Null
        $stopped = $true
    }
}

if ($stopped) { Write-Host 'FWallSim stopped.' -ForegroundColor Green }
else { Write-Host 'FWallSim was not running.' -ForegroundColor Yellow }
