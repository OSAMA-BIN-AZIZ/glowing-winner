#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
DB_NAME="blog.db"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD=""
ADMIN_USER_PROVIDED=0
ADMIN_PASS_PROVIDED=0
DATA_DIR="/www/wwwdata/glowing-winner-data"
UPLOAD_DIR=""
SECRET_KEY=""
INIT_DB=1
INIT_ADMIN=1
FLASK_RUNNER=()

usage() {
  cat <<'USAGE'
快速配置脚本（生成 .env + 可选初始化数据库/管理员）

用法:
  bash quick_setup.sh [选项]

选项:
  --db-name <name>          数据库文件名（默认: blog.db）
  --admin-user <name>       管理员用户名（不传则随机生成）
  --admin-pass <pass>       管理员密码（不传则随机生成）
  --data-dir <path>         数据目录（默认: /www/wwwdata/glowing-winner-data）
  --upload-dir <path>       上传目录（默认: <data-dir>/uploads）
  --secret-key <value>      Flask SECRET_KEY（不传则自动生成）
  --init-db                 写入 .env 后执行 flask init-db（默认已开启）
  --init-admin              写入 .env 后执行 flask init-admin（默认已开启，未传密码则自动生成）
  --no-init-db              仅写入 .env，不执行 init-db
  --no-init-admin           仅写入 .env，不执行 init-admin
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
      ADMIN_USERNAME="$2"; ADMIN_USER_PROVIDED=1; shift 2 ;;
    --admin-pass)
      ADMIN_PASSWORD="$2"; ADMIN_PASS_PROVIDED=1; shift 2 ;;
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
    --no-init-db)
      INIT_DB=0; shift ;;
    --no-init-admin)
      INIT_ADMIN=0; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "未知参数: $1"
      usage
      exit 1 ;;
  esac
done

detect_flask_runner() {
  if command -v flask >/dev/null 2>&1; then
    FLASK_RUNNER=(flask)
    return
  fi

  if command -v python3 >/dev/null 2>&1 && python3 -m flask --version >/dev/null 2>&1; then
    FLASK_RUNNER=(python3 -m flask)
    return
  fi

  ensure_flask_installed

  if command -v flask >/dev/null 2>&1; then
    FLASK_RUNNER=(flask)
    return
  fi
  if command -v python3 >/dev/null 2>&1 && python3 -m flask --version >/dev/null 2>&1; then
    FLASK_RUNNER=(python3 -m flask)
    return
  fi

  echo "❌ Flask 依赖自动安装后仍不可用，请手动检查 Python/pip 环境。"
  exit 1
}

ensure_flask_installed() {
  if ! command -v python3 >/dev/null 2>&1; then
    echo "❌ 未找到 python3，无法自动安装 Flask 依赖。"
    exit 1
  fi

  echo "⚠️  未检测到可用的 Flask 命令，开始自动安装依赖..."

  if [[ ! -f "$PROJECT_DIR/venv/bin/activate" ]]; then
    python3 -m venv "$PROJECT_DIR/venv"
  fi

  # shellcheck disable=SC1091
  source "$PROJECT_DIR/venv/bin/activate"

  pip install -r "$PROJECT_DIR/requirements.txt"
}

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

if [[ $ADMIN_USER_PROVIDED -eq 0 ]]; then
  ADMIN_USERNAME="admin_$(python3 - <<'PY'
import secrets
print(secrets.token_hex(3))
PY
)"
fi

if [[ $ADMIN_PASS_PROVIDED -eq 0 ]]; then
  ADMIN_PASSWORD="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(16))
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
BLOG_DEBUG=true
BLOG_SHOW_LOGIN_FAILURE_REASON=true
ENVEOF

echo "✅ 已写入配置: $ENV_FILE"
echo "   - BLOG_DB_NAME=$DB_NAME"
echo "   - BLOG_ADMIN_USERNAME=$ADMIN_USERNAME"
echo "   - BLOG_ADMIN_PASSWORD=$ADMIN_PASSWORD"
echo "   - BLOG_DEBUG=true"
echo "   - BLOG_SHOW_LOGIN_FAILURE_REASON=true"
echo "   - BLOG_DATA_DIR=$DATA_DIR"
echo "   - BLOG_UPLOAD_DIR=$UPLOAD_DIR"

if [[ $INIT_DB -eq 1 || $INIT_ADMIN -eq 1 ]]; then
  cd "$PROJECT_DIR"
  if [[ -f "$PROJECT_DIR/venv/bin/activate" ]]; then
    # shellcheck disable=SC1091
    source "$PROJECT_DIR/venv/bin/activate"
  fi
  detect_flask_runner
fi

if [[ $INIT_DB -eq 1 ]]; then
  echo "▶ 初始化数据库..."
  "${FLASK_RUNNER[@]}" --app app.py init-db
fi

if [[ $INIT_ADMIN -eq 1 ]]; then
  echo "▶ 初始化管理员..."
  BLOG_ADMIN_USERNAME="$ADMIN_USERNAME" BLOG_ADMIN_PASSWORD="$ADMIN_PASSWORD" "${FLASK_RUNNER[@]}" --app app.py init-admin
fi

echo "🎉 快速配置完成。"
echo "🔐 管理员账号: $ADMIN_USERNAME"
echo "🔐 管理员密码: $ADMIN_PASSWORD"
if [[ $INIT_ADMIN -eq 0 ]]; then
  echo "⚠️  当前仅写入 .env，尚未初始化管理员到数据库。"
  echo "   如需创建管理员，请执行（优先）："
  echo "   BLOG_ADMIN_USERNAME=\"$ADMIN_USERNAME\" BLOG_ADMIN_PASSWORD=\"$ADMIN_PASSWORD\" python3 -m flask --app app.py init-admin"
  echo "   （若已安装 flask 命令，也可将 'python3 -m flask' 替换为 'flask'）"
fi
