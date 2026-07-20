#!/usr/bin/env bash
# One-shot: update and start PokerStraton on the VPS (run as root).
set -euo pipefail
cd /opt/PokerStarton

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi

git pull --ff-only origin main
if [[ ! -f .env ]]; then
  cp .env.vps.example .env
  echo "Created .env — edit passwords, then re-run this script."
  exit 1
fi

docker compose up -d --build
echo "Waiting for health..."
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1/health >/dev/null 2>&1 || curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then
    echo "OK — open http://$(curl -fsS ifconfig.me 2>/dev/null || echo YOUR_IP)/"
    docker compose ps
    exit 0
  fi
  sleep 2
done
echo "Health check failed. Logs:"
docker compose ps
docker compose logs --tail=80 app
exit 1
