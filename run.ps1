$ErrorActionPreference = "Stop"

Write-Host "Starting NauPanel with Docker Compose..." -ForegroundColor Cyan

try {
  $null = Get-Command docker -ErrorAction Stop
} catch {
  Write-Host "Docker is not installed or not in PATH." -ForegroundColor Red
  exit 1
}

docker compose up -d --build

if ($LASTEXITCODE -ne 0) {
  Write-Host "Docker Compose failed." -ForegroundColor Red
  exit $LASTEXITCODE
}

Write-Host "Done." -ForegroundColor Green
Write-Host "Frontend: http://localhost:4200" -ForegroundColor Green
Write-Host "Backend:  http://localhost:3000" -ForegroundColor Green
