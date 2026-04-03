#!/bin/bash
set -e

PROJECT_DIR="/www/wwwroot/glowing-winner"
VENV_DIR="/www/wwwroot/glowing-winner/venv"
BRANCH="main"
SERVICE_NAME="glowing-winner"
LOCK_FILE="/tmp/glowing-winner-deploy.lock"

echo "========================================"
echo "开始部署 glowing-winner"
echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "检测到已有部署任务正在执行，退出本次部署。"
  exit 1
fi

echo "[1/6] 进入项目目录: $PROJECT_DIR"
cd "$PROJECT_DIR"

echo "[2/6] 拉取最新代码"
git fetch --all
git reset --hard "origin/$BRANCH"

echo "[3/6] 激活虚拟环境"
source "$VENV_DIR/bin/activate"

echo "[4/6] 安装/更新 Python 依赖"
pip install -r requirements.txt

echo "[5/6] 预留初始化步骤（如数据库迁移）"
# 示例（按需启用）:
# flask db upgrade
# flask --app app.py init-db

echo "[6/6] 重启服务: $SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
systemctl is-active --quiet "$SERVICE_NAME"

echo "========================================"
echo "部署完成: glowing-winner 已更新到 origin/$BRANCH"
echo "完成时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"
