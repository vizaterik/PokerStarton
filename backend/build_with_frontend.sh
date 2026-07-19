#!/usr/bin/env bash
# Native Render (Python) build: install deps + build React into ../frontend/dist
set -euo pipefail
cd "$(dirname "$0")"
pip install -r requirements.txt

if ! command -v npm >/dev/null 2>&1; then
  echo "Installing Node 20 via nvm..."
  export NVM_DIR="$HOME/.nvm"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
fi

FRONT="$(cd ../frontend && pwd)"
echo "Building frontend (same-origin, empty VITE_API_BASE) in $FRONT"
(cd "$FRONT" && npm ci && VITE_API_BASE= npm run build)
echo "Frontend ready at $FRONT/dist"
