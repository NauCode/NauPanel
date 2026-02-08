#!/usr/bin/env bash
set -euo pipefail

echo "Starting NauPanel with Docker Compose..."

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not in PATH."
  exit 1
fi

docker compose up -d --build

echo "Done."
echo "Frontend: http://localhost:4200"
echo "Backend:  http://localhost:3000"
