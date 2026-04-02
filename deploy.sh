#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/www/wwwroot/blog"
BRANCH="main"
VENV_DIR="$PROJECT_DIR/venv"
SERVICE_NAME="blog.service"

cd "$PROJECT_DIR"

echo "[deploy] Syncing code from origin/$BRANCH..."
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "[deploy] Installing dependencies..."
source "$VENV_DIR/bin/activate"
pip install --upgrade pip
pip install -r requirements.txt

echo "[deploy] Migrating/ensuring database..."
flask --app app.py init-db

echo "[deploy] Restarting systemd service: $SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl status "$SERVICE_NAME" --no-pager -l

echo "[deploy] Done."
