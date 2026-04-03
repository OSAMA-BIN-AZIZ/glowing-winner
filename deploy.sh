#!/bin/bash
set -e

PROJECT_DIR="${PROJECT_DIR:-/www/wwwroot/glowing-winner}"
VENV_DIR="${VENV_DIR:-$PROJECT_DIR/venv}"
BRANCH="${BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-glowing-winner}"
REMOTE_NAME="${REMOTE_NAME:-origin}"
LOCK_FILE="${LOCK_FILE:-/tmp/glowing-winner-deploy.lock}"

echo "========================================"
echo "开始部署 glowing-winner"
echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "项目目录: $PROJECT_DIR"
echo "分支: $REMOTE_NAME/$BRANCH"
echo "========================================"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "检测到已有部署任务正在执行，退出本次部署。"
  exit 1
fi

echo "[1/7] 进入项目目录: $PROJECT_DIR"
cd "$PROJECT_DIR"

echo "[2/7] 拉取远端最新代码"
git fetch --all --prune

echo "[3/7] 同步服务器代码到 $REMOTE_NAME/$BRANCH"
git reset --hard "$REMOTE_NAME/$BRANCH"

echo "[4/7] 激活虚拟环境"
source "$VENV_DIR/bin/activate"

echo "[5/7] 安装/更新 Python 依赖"
pip install -r requirements.txt

echo "[6/7] 预留初始化步骤（如数据库迁移）"
# 示例（按需启用）:
# flask db upgrade
# flask --app app.py init-db

echo "[7/7] 重启服务: $SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
systemctl is-active --quiet "$SERVICE_NAME"

echo "========================================"
echo "部署完成: 服务器已同步到 $REMOTE_NAME/$BRANCH 最新代码"
echo "完成时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"
