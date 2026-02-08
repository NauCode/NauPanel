#!/usr/bin/env bash
set -euo pipefail

echo "Starting backend (prod)..."

npm install
npm run build
npm start
