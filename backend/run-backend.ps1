$ErrorActionPreference = "Stop"

Write-Host "Starting backend (prod)..." -ForegroundColor Cyan

npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm start
