#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/www/wwwroot/glowing-winner}"
LISTENER_SCRIPT="${LISTENER_SCRIPT:-$PROJECT_DIR/scripts/webhook_listener.py}"
DEPLOY_SCRIPT="${DEPLOY_SCRIPT:-$PROJECT_DIR/deploy.sh}"
WEBHOOK_SERVICE_NAME="${WEBHOOK_SERVICE_NAME:-glowing-winner-webhook}"
APP_SERVICE_NAME="${APP_SERVICE_NAME:-glowing-winner}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-}"
WEBHOOK_USER="${WEBHOOK_USER:-www}"
WEBHOOK_GROUP="${WEBHOOK_GROUP:-www}"
WEBHOOK_HOST="${WEBHOOK_HOST:-127.0.0.1}"
WEBHOOK_PORT="${WEBHOOK_PORT:-9001}"
WEBHOOK_PATH="${WEBHOOK_PATH:-/github-webhook}"
WEBHOOK_TARGET_REF="${WEBHOOK_TARGET_REF:-refs/heads/main}"
ENV_FILE="/etc/default/${WEBHOOK_SERVICE_NAME}"
UNIT_FILE="/etc/systemd/system/${WEBHOOK_SERVICE_NAME}.service"

usage() {
  cat <<USAGE
自动化配置 GitHub Push -> Webhook -> deploy.sh

用法:
  sudo WEBHOOK_SECRET='你的密钥' bash scripts/auto_setup_webhook.sh [选项]

可选环境变量:
  PROJECT_DIR           项目目录（默认: /www/wwwroot/glowing-winner）
  APP_SERVICE_NAME      Web 应用 systemd 服务名（默认: glowing-winner）
  WEBHOOK_SERVICE_NAME  Webhook 监听器 systemd 服务名（默认: glowing-winner-webhook）
  WEBHOOK_USER          运行 webhook 服务用户（默认: www）
  WEBHOOK_GROUP         运行 webhook 服务组（默认: www）
  WEBHOOK_SECRET        GitHub webhook secret（必填）
  WEBHOOK_HOST          监听地址（默认: 127.0.0.1）
  WEBHOOK_PORT          监听端口（默认: 9001）
  WEBHOOK_PATH          Webhook 路径（默认: /github-webhook）
  WEBHOOK_TARGET_REF    触发部署分支引用（默认: refs/heads/main）

脚本会执行:
  1) 校验关键文件存在
  2) 给 deploy.sh 增加执行权限
  3) 写入 /etc/default/<webhook-service>
  4) 生成并启用 systemd webhook 服务
  5) 验证 webhook 与应用服务状态
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $EUID -ne 0 ]]; then
  echo "❌ 请使用 root 或 sudo 运行该脚本。"
  exit 1
fi

if [[ -z "$WEBHOOK_SECRET" ]]; then
  echo "❌ WEBHOOK_SECRET 不能为空。"
  echo "示例: sudo WEBHOOK_SECRET='your-secret' bash scripts/auto_setup_webhook.sh"
  exit 1
fi

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "❌ 项目目录不存在: $PROJECT_DIR"
  exit 1
fi

if [[ ! -f "$LISTENER_SCRIPT" ]]; then
  echo "❌ webhook 监听脚本不存在: $LISTENER_SCRIPT"
  exit 1
fi

if [[ ! -f "$DEPLOY_SCRIPT" ]]; then
  echo "❌ 部署脚本不存在: $DEPLOY_SCRIPT"
  exit 1
fi

if ! id "$WEBHOOK_USER" >/dev/null 2>&1; then
  echo "❌ 运行用户不存在: $WEBHOOK_USER"
  exit 1
fi

if ! getent group "$WEBHOOK_GROUP" >/dev/null 2>&1; then
  echo "❌ 运行用户组不存在: $WEBHOOK_GROUP"
  exit 1
fi

echo "[1/6] 设置 deploy.sh 可执行权限"
chmod +x "$DEPLOY_SCRIPT"

echo "[2/6] 写入 webhook 环境变量文件: $ENV_FILE"
cat > "$ENV_FILE" <<ENVEOF
GITHUB_WEBHOOK_SECRET=$WEBHOOK_SECRET
DEPLOY_SCRIPT=$DEPLOY_SCRIPT
WEBHOOK_HOST=$WEBHOOK_HOST
WEBHOOK_PORT=$WEBHOOK_PORT
WEBHOOK_PATH=$WEBHOOK_PATH
WEBHOOK_TARGET_REF=$WEBHOOK_TARGET_REF
ENVEOF
chmod 600 "$ENV_FILE"

echo "[3/6] 生成 systemd 单元: $UNIT_FILE"
cat > "$UNIT_FILE" <<UNITEOF
[Unit]
Description=GitHub Webhook Listener for ${APP_SERVICE_NAME}
After=network.target

[Service]
Type=simple
User=${WEBHOOK_USER}
Group=${WEBHOOK_GROUP}
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/env python3 ${LISTENER_SCRIPT}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNITEOF

echo "[4/6] 重载并启用 webhook 服务"
systemctl daemon-reload
systemctl enable --now "${WEBHOOK_SERVICE_NAME}.service"

echo "[5/6] 检查 webhook 服务状态"
systemctl --no-pager --full status "${WEBHOOK_SERVICE_NAME}.service"

echo "[6/6] 检查应用服务状态"
if systemctl is-enabled --quiet "${APP_SERVICE_NAME}.service"; then
  systemctl --no-pager --full status "${APP_SERVICE_NAME}.service"
else
  echo "⚠️ 应用服务 ${APP_SERVICE_NAME}.service 未启用，请确认服务名是否正确。"
fi

echo "✅ 自动化配置完成。"
echo "下一步：在 GitHub 仓库 Webhook 中配置 push 事件与 Secret。"
echo "Webhook 地址: http://${WEBHOOK_HOST}:${WEBHOOK_PORT}${WEBHOOK_PATH}"
