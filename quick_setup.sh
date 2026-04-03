#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
DB_NAME="blog.db"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD=""
DATA_DIR="/www/wwwdata/glowing-winner-data"
UPLOAD_DIR=""
SECRET_KEY=""
INIT_DB=0
INIT_ADMIN=0

usage() {
  cat <<'USAGE'
快速配置脚本（生成 .env + 可选初始化数据库/管理员）

用法:
  bash quick_setup.sh [选项]

选项:
  --db-name <name>          数据库文件名（默认: blog.db）
  --admin-user <name>       管理员用户名（默认: admin）
  --admin-pass <pass>       管理员密码（建议强密码）
  --data-dir <path>         数据目录（默认: /www/wwwdata/glowing-winner-data）
  --upload-dir <path>       上传目录（默认: <data-dir>/uploads）
  --secret-key <value>      Flask SECRET_KEY（不传则自动生成）
  --init-db                 写入 .env 后执行 flask init-db
  --init-admin              写入 .env 后执行 flask init-admin（需提供管理员密码）
  -h, --help                显示帮助

示例:
  bash quick_setup.sh --db-name blog_prod.db --admin-user superadmin --admin-pass 'StrongPass#2026' --init-db --init-admin
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db-name)
      DB_NAME="$2"; shift 2 ;;
    --admin-user)
      ADMIN_USERNAME="$2"; shift 2 ;;
    --admin-pass)
      ADMIN_PASSWORD="$2"; shift 2 ;;
    --data-dir)
      DATA_DIR="$2"; shift 2 ;;
    --upload-dir)
      UPLOAD_DIR="$2"; shift 2 ;;
    --secret-key)
      SECRET_KEY="$2"; shift 2 ;;
    --init-db)
      INIT_DB=1; shift ;;
    --init-admin)
      INIT_ADMIN=1; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "未知参数: $1"
      usage
      exit 1 ;;
  esac
done

if [[ -z "$UPLOAD_DIR" ]]; then
  UPLOAD_DIR="$DATA_DIR/uploads"
fi

if [[ -z "$SECRET_KEY" ]]; then
  SECRET_KEY="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
)"
fi

mkdir -p "$DATA_DIR" "$UPLOAD_DIR"

cat > "$ENV_FILE" <<ENVEOF
SECRET_KEY=$SECRET_KEY
BLOG_DATA_DIR=$DATA_DIR
BLOG_DB_NAME=$DB_NAME
BLOG_UPLOAD_DIR=$UPLOAD_DIR
BLOG_ADMIN_USERNAME=$ADMIN_USERNAME
BLOG_ADMIN_PASSWORD=$ADMIN_PASSWORD
ENVEOF

echo "✅ 已写入配置: $ENV_FILE"
echo "   - BLOG_DB_NAME=$DB_NAME"
echo "   - BLOG_ADMIN_USERNAME=$ADMIN_USERNAME"
echo "   - BLOG_DATA_DIR=$DATA_DIR"
echo "   - BLOG_UPLOAD_DIR=$UPLOAD_DIR"

if [[ $INIT_ADMIN -eq 1 && -z "$ADMIN_PASSWORD" ]]; then
  echo "❌ --init-admin 需要 --admin-pass"
  exit 1
fi

if [[ $INIT_DB -eq 1 || $INIT_ADMIN -eq 1 ]]; then
  cd "$PROJECT_DIR"
  if [[ -f "$PROJECT_DIR/venv/bin/activate" ]]; then
    # shellcheck disable=SC1091
    source "$PROJECT_DIR/venv/bin/activate"
  fi
fi

if [[ $INIT_DB -eq 1 ]]; then
  echo "▶ 初始化数据库..."
  flask --app app.py init-db
fi

if [[ $INIT_ADMIN -eq 1 ]]; then
  echo "▶ 初始化管理员..."
  BLOG_ADMIN_USERNAME="$ADMIN_USERNAME" BLOG_ADMIN_PASSWORD="$ADMIN_PASSWORD" flask --app app.py init-admin
fi

echo "🎉 快速配置完成。"
