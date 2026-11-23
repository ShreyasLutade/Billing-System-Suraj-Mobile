#!/usr/bin/env bash
# Bootstrap an Always Free e2-micro VM for Suraj Billing.
# Run as a user with sudo on a fresh Debian/Ubuntu image.
set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/Billing-System-Suraj-Mobile}"
BRANCH="${BRANCH:-deploy/gcp-cloudflare-free}"
REPO_URL="${REPO_URL:-}"

echo "==> Installing Docker + Compose plugin"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl git ufw

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER" || true

echo "==> Enabling swap (helps e2-micro under Node builds)"
if ! sudo swapon --show | grep -q .; then
  sudo fallocate -l 1G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=1024
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo "==> Firewall: allow SSH + HTTP/HTTPS only"
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable || true

if [ -n "$REPO_URL" ]; then
  if [ ! -d "$REPO_DIR/.git" ]; then
    git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"
  else
    git -C "$REPO_DIR" fetch origin
    git -C "$REPO_DIR" checkout "$BRANCH"
    git -C "$REPO_DIR" pull --ff-only origin "$BRANCH"
  fi
fi

cd "$REPO_DIR"
if [ ! -f deploy/gcp/.env ]; then
  cp deploy/gcp/.env.example deploy/gcp/.env
  echo "Created deploy/gcp/.env — edit secrets before starting."
fi

mkdir -p deploy/gcp/certs
echo "==> Bootstrap done."
echo "Next:"
echo "  1) Edit $REPO_DIR/deploy/gcp/.env"
echo "  2) docker compose -f deploy/gcp/docker-compose.yml --env-file deploy/gcp/.env up -d --build"
echo "  3) Point Cloudflare A record for api.* to this VM (proxied)"
echo "Note: re-login (or newgrp docker) if 'docker' permission is denied."
