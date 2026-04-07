#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/glowing-winner.conf}"
WEBHOOK_PATH="${WEBHOOK_PATH:-/github-webhook}"
WEBHOOK_UPSTREAM_HOST="${WEBHOOK_UPSTREAM_HOST:-127.0.0.1}"
WEBHOOK_UPSTREAM_PORT="${WEBHOOK_UPSTREAM_PORT:-9001}"
WEBHOOK_UPSTREAM_SCHEME="${WEBHOOK_UPSTREAM_SCHEME:-http}"
CERTBOT_BIN="${CERTBOT_BIN:-certbot}"
SKIP_CERTBOT="${SKIP_CERTBOT:-0}"

usage() {
  cat <<USAGE
自动化配置 Nginx 反代 /github-webhook + HTTPS（Let's Encrypt）

用法（推荐）:
  sudo DOMAIN='example.com' EMAIL='ops@example.com' \
  NGINX_CONF='/etc/nginx/conf.d/glowing-winner.conf' \
  bash scripts/auto_setup_webhook_https.sh

可选环境变量:
  DOMAIN                  站点域名（必填）
  EMAIL                   Let's Encrypt 通知邮箱（必填，SKIP_CERTBOT=1 时可空）
  NGINX_CONF              Nginx 站点配置文件（默认: /etc/nginx/conf.d/glowing-winner.conf）
  WEBHOOK_PATH            Webhook 路径（默认: /github-webhook）
  WEBHOOK_UPSTREAM_SCHEME upstream 协议（默认: http）
  WEBHOOK_UPSTREAM_HOST   upstream 主机（默认: 127.0.0.1）
  WEBHOOK_UPSTREAM_PORT   upstream 端口（默认: 9001）
  SKIP_CERTBOT            跳过证书申请，仅写入反代配置（默认: 0）

脚本会执行:
  1) 在指定 server_name 的 server{} 中注入 webhook location（幂等）
  2) nginx -t 校验并 reload
  3) certbot --nginx 自动签发并配置 HTTPS（可选）
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

if [[ -z "$DOMAIN" ]]; then
  echo "❌ DOMAIN 不能为空。"
  exit 1
fi

if [[ "$SKIP_CERTBOT" != "1" && -z "$EMAIL" ]]; then
  echo "❌ 未跳过证书申请时，EMAIL 不能为空。"
  exit 1
fi

if [[ ! -f "$NGINX_CONF" ]]; then
  echo "❌ Nginx 配置文件不存在: $NGINX_CONF"
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "❌ nginx 未安装或不在 PATH。"
  exit 1
fi

if [[ "$SKIP_CERTBOT" != "1" ]] && ! command -v "$CERTBOT_BIN" >/dev/null 2>&1; then
  echo "❌ certbot 未安装或不在 PATH。可先设置 SKIP_CERTBOT=1 仅配置反代。"
  exit 1
fi

if [[ ! "$WEBHOOK_PATH" =~ ^/ ]]; then
  echo "❌ WEBHOOK_PATH 必须以 / 开头。"
  exit 1
fi

BACKUP_PATH="${NGINX_CONF}.bak.$(date +%Y%m%d%H%M%S)"
cp "$NGINX_CONF" "$BACKUP_PATH"
echo "[1/5] 已备份配置: $BACKUP_PATH"

python3 - "$NGINX_CONF" "$DOMAIN" "$WEBHOOK_PATH" "$WEBHOOK_UPSTREAM_SCHEME" "$WEBHOOK_UPSTREAM_HOST" "$WEBHOOK_UPSTREAM_PORT" <<'PY'
import re
import sys
from pathlib import Path

conf_path = Path(sys.argv[1])
domain = sys.argv[2]
webhook_path = sys.argv[3]
upstream_scheme = sys.argv[4]
upstream_host = sys.argv[5]
upstream_port = sys.argv[6]

start_marker = "# BEGIN AUTO_WEBHOOK_PROXY"
end_marker = "# END AUTO_WEBHOOK_PROXY"

location_block = f"""{start_marker}
    location = {webhook_path} {{
        proxy_pass {upstream_scheme}://{upstream_host}:{upstream_port}{webhook_path};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 120s;
        client_max_body_size 2m;
        limit_except POST {{ deny all; }}
    }}
{end_marker}
"""

text = conf_path.read_text(encoding="utf-8")

# Remove existing managed block (idempotent).
text = re.sub(
    rf"\n?\s*{re.escape(start_marker)}.*?{re.escape(end_marker)}\n?",
    "\n",
    text,
    flags=re.S,
)

server_pattern = re.compile(r"server\s*\{", re.M)
server_starts = [m.start() for m in server_pattern.finditer(text)]

if not server_starts:
    raise SystemExit("未找到 server{} 配置块")


def find_block_end(src: str, start_index: int) -> int:
    depth = 0
    i = start_index
    while i < len(src):
        ch = src[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1

selected_start = None
selected_end = None

for s in server_starts:
    e = find_block_end(text, s)
    if e == -1:
        continue
    block = text[s : e + 1]
    if re.search(rf"server_name\s+[^;]*\b{re.escape(domain)}\b[^;]*;", block):
        selected_start, selected_end = s, e
        break

if selected_start is None:
    raise SystemExit(f"未找到包含 server_name {domain} 的 server 块")

server_block = text[selected_start : selected_end + 1]
insert_at = server_block.rfind("}")
if insert_at == -1:
    raise SystemExit("目标 server 块结构异常")

updated_server = server_block[:insert_at] + "\n" + location_block + server_block[insert_at:]
updated = text[:selected_start] + updated_server + text[selected_end + 1 :]

conf_path.write_text(updated, encoding="utf-8")
print("OK")
PY

echo "[2/5] 已注入 webhook 反代 location 到: $NGINX_CONF"

echo "[3/5] 校验 Nginx 配置"
nginx -t

echo "[4/5] 重载 Nginx"
systemctl reload nginx

if [[ "$SKIP_CERTBOT" == "1" ]]; then
  echo "[5/5] 已跳过 certbot（SKIP_CERTBOT=1）"
else
  echo "[5/5] 申请/更新 HTTPS 证书并自动启用跳转"
  "$CERTBOT_BIN" --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --no-eff-email --non-interactive --redirect
  nginx -t
  systemctl reload nginx
fi

echo "✅ 完成：已配置 ${DOMAIN}${WEBHOOK_PATH} -> ${WEBHOOK_UPSTREAM_SCHEME}://${WEBHOOK_UPSTREAM_HOST}:${WEBHOOK_UPSTREAM_PORT}${WEBHOOK_PATH}"
