#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"

echo "[1/4] Installing bridge dependencies"
cd "$REPO_ROOT/bridge"
npm install --include=dev

echo "[2/4] Building bridge"
npm run build

echo "[3/4] Installing gateway dependencies"
cd "$REPO_ROOT/gateway"
npm install --include=dev

echo "[4/4] Building gateway"
npm run build

echo "Build completed."
