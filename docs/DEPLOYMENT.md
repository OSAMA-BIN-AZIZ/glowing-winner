# 详细部署操作说明（Flask + Gunicorn + Nginx + systemd）

本文档面向 **Ubuntu/Debian/CentOS 等 Linux 服务器**，以本项目为例给出可直接执行的部署流程，包含：

- 首次上线（手工部署）
- 生产服务托管（systemd）
- Nginx 反向代理与静态资源映射
- 自动部署（GitHub Webhook + deploy.sh）
- 常见故障排查与回滚

> 文中默认项目目录为：`/www/wwwroot/glowing-winner`。如果你的目录不同，请同步替换命令中的路径。

---

## 1. 部署前准备

### 1.1 服务器建议配置

- CPU：1 vCPU 起
- 内存：1 GB 起（本项目默认 Gunicorn 2 workers）
- 系统：Ubuntu 22.04+/Debian 12+/CentOS 7+
- 已开放端口：`80`（HTTP）与可选 `443`（HTTPS）

### 1.2 安装基础依赖

```bash
# Debian/Ubuntu
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip nginx

# CentOS/RHEL（参考）
# sudo yum install -y git python3 python3-pip nginx
```

### 1.3 创建运行用户（可选）

如果你不使用面板默认用户（如 `www`），可创建专门用户：

```bash
sudo useradd -r -s /usr/sbin/nologin blog || true
```

---

## 2. 获取项目代码与创建虚拟环境

```bash
# 1) 克隆代码
sudo mkdir -p /www/wwwroot
cd /www/wwwroot
sudo git clone <你的仓库地址> glowing-winner
cd glowing-winner

# 2) 创建虚拟环境并安装依赖
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

---

## 3. 配置生产数据目录（强烈建议与代码目录分离）

为避免代码更新覆盖数据库和上传文件，使用独立目录：

```bash
sudo mkdir -p /www/wwwdata/glowing-winner-data/uploads
sudo chown -R www:www /www/wwwdata/glowing-winner-data
sudo chmod -R 755 /www/wwwdata/glowing-winner-data
```

> 如果你的服务用户不是 `www`，请替换为对应用户组。

---

## 4. 配置环境变量（.env）

在项目根目录创建 `.env`：

```bash
cat > /www/wwwroot/glowing-winner/.env <<'ENVEOF'
SECRET_KEY=请替换为高强度随机字符串
BLOG_DATA_DIR=/www/wwwdata/glowing-winner-data
BLOG_DB_NAME=blog.db
# 或直接指定完整路径（优先级更高）
# BLOG_DB_PATH=/www/wwwdata/glowing-winner-data/blog.db
BLOG_UPLOAD_DIR=/www/wwwdata/glowing-winner-data/uploads

# 管理员初始化默认变量（可选）
BLOG_ADMIN_USERNAME=admin
BLOG_ADMIN_PASSWORD=请替换为复杂强密码
ENVEOF
```

生成随机 `SECRET_KEY`（任选其一）：

```bash
python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
```

---

## 4.1 快速配置脚本（可选）

项目根目录提供 `quick_setup.sh`，用于快速写入 `.env`，并可选执行数据库与管理员初始化：

```bash
cd /www/wwwroot/glowing-winner
bash quick_setup.sh \
  --db-name blog_prod.db \
  --admin-user admin \
  --admin-pass 'StrongPass#2026' \
  --init-db --init-admin
```

查看全部参数：

```bash
bash quick_setup.sh --help
```

## 5. 初始化数据库与管理员

```bash
cd /www/wwwroot/glowing-winner
source venv/bin/activate

# 初始化数据库
flask --app app.py init-db

# 初始化管理员（必须显式传入强密码）
INIT_ADMIN_USERNAME=admin \
INIT_ADMIN_PASSWORD='请替换为复杂强密码' \
flask --app app.py init-admin

# 或使用部署环境变量
BLOG_ADMIN_USERNAME=admin \
BLOG_ADMIN_PASSWORD='请替换为复杂强密码' \
flask --app app.py init-admin
```

初始化完成后，可先用 Gunicorn 手工验证：

```bash
gunicorn -w 2 -b 127.0.0.1:8000 app:app
```

浏览器访问 `http://服务器IP:8000`（或通过 SSH 隧道）确认页面可打开后，再继续 systemd 与 Nginx 配置。

---

## 6. 配置 systemd 守护进程

项目里已有 `glowing-winner.service`，建议复制到系统目录后启用：

```bash
sudo cp /www/wwwroot/glowing-winner/glowing-winner.service /etc/systemd/system/glowing-winner.service
sudo systemctl daemon-reload
sudo systemctl enable glowing-winner.service
sudo systemctl start glowing-winner.service
```

检查状态：

```bash
sudo systemctl status glowing-winner.service --no-pager
sudo journalctl -u glowing-winner.service -n 100 --no-pager
```

如果服务文件中的路径与你实际目录不一致，请先修改再重载。

---

## 7. 配置 Nginx 反向代理

新建站点配置（示例）：

```bash
sudo tee /etc/nginx/conf.d/glowing-winner.conf > /dev/null <<'NGINXEOF'
server {
    listen 80;
    server_name your-domain.com;

    # 上传文件映射（外部目录）
    location /static/uploads/ {
        alias /www/wwwdata/glowing-winner-data/uploads/;
        expires 30d;
        add_header Cache-Control "public";
    }

    # 项目静态资源
    location /static/ {
        alias /www/wwwroot/glowing-winner/static/;
        expires 7d;
        add_header Cache-Control "public";
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
    }
}
NGINXEOF
```

测试并重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 8. 自动部署（GitHub Push -> Webhook -> deploy.sh）

### 8.1 脚本位置

项目根目录已有 `deploy.sh`，核心流程：

1. 获取部署锁（防并发重复部署）
2. `git fetch` + `git reset --hard origin/main`
3. 激活虚拟环境
4. 安装依赖
5. 重启 `glowing-winner` 服务

### 8.2 赋予执行权限

```bash
cd /www/wwwroot/glowing-winner
chmod +x deploy.sh
```

### 8.3 在面板/Webhook 中配置执行命令

```bash
bash /www/wwwroot/glowing-winner/deploy.sh
```

建议仅允许 `main` 分支触发，并在 webhook 层增加签名校验。

---

### 8.4 自定义部署参数（可选）

`deploy.sh` 支持通过环境变量覆盖默认值，便于多环境部署：

```bash
PROJECT_DIR=/www/wwwroot/glowing-winner \
VENV_DIR=/www/wwwroot/glowing-winner/venv \
BRANCH=main \
REMOTE_NAME=origin \
SERVICE_NAME=glowing-winner \
bash /www/wwwroot/glowing-winner/deploy.sh
```

这样可以确保 **Git 仓库最新代码** 和 **服务器运行版本** 保持同步。

## 9. 上线后核验清单

部署完成后逐项验证：

```bash
# 1) 服务是否运行
systemctl is-active glowing-winner.service

# 2) 本机反代源是否可访问
curl -I http://127.0.0.1:8000

# 3) Nginx 是否正常
nginx -t
systemctl is-active nginx

# 4) 首页可达性
curl -I http://your-domain.com
```

后台登录地址默认：`/admin/login`。

---

## 10. 常见问题排查

### 10.1 502 Bad Gateway

通常是 Gunicorn 未启动或端口不一致：

```bash
sudo systemctl status glowing-winner.service --no-pager
sudo journalctl -u glowing-winner.service -n 200 --no-pager
ss -lntp | rg 8000
```

### 10.2 上传图片 404

重点检查 Nginx `alias` 与 `BLOG_UPLOAD_DIR` 是否一致：

- `BLOG_UPLOAD_DIR=/www/wwwdata/glowing-winner-data/uploads`
- `location /static/uploads/ { alias /www/wwwdata/glowing-winner-data/uploads/; }`

两者路径必须指向同一目录。

### 10.3 管理员初始化失败

若提示缺少 `INIT_ADMIN_PASSWORD`，请显式传入：

```bash
INIT_ADMIN_USERNAME=admin INIT_ADMIN_PASSWORD='强密码' flask --app app.py init-admin
```

### 10.4 权限错误（Permission denied）

确认运行用户有读写数据目录权限：

```bash
sudo chown -R www:www /www/wwwdata/glowing-winner-data
sudo chmod -R 755 /www/wwwdata/glowing-winner-data
```

---

## 11. 回滚方案（建议）

最稳妥回滚方式：

1. 数据层：每日备份 `blog.db` 与 `uploads/`
2. 代码层：记录可回滚 commit id
3. 故障时回滚代码并重启服务

示例：

```bash
cd /www/wwwroot/glowing-winner
git log --oneline -n 20
git reset --hard <稳定版本commit>
systemctl restart glowing-winner.service
```

---

## 12. 安全加固建议（上线后尽快完成）

- 使用 HTTPS（Let's Encrypt + 自动续期）
- 设置强 `SECRET_KEY`，并定期更换管理员密码
- 限制后台路径访问来源（如只允许办公 IP）
- 配置基础防火墙（仅开放 22/80/443）
- 对 `blog.db` 和 `uploads/` 做定期异地备份


---

## 13. 一键自动化配置 Webhook（新增）

如果你希望把“创建 webhook systemd 服务 + 启用监听 + 绑定 deploy.sh”一步做完，可使用：

```bash
cd /www/wwwroot/glowing-winner
sudo WEBHOOK_SECRET='请替换为强随机字符串' \
APP_SERVICE_NAME='glowing-winner' \
WEBHOOK_SERVICE_NAME='glowing-winner-webhook' \
WEBHOOK_HOST='127.0.0.1' \
WEBHOOK_PORT='9001' \
WEBHOOK_PATH='/github-webhook' \
WEBHOOK_TARGET_REF='refs/heads/main' \
bash scripts/auto_setup_webhook.sh
```

脚本会自动完成：

1. 校验 `scripts/webhook_listener.py` 和 `deploy.sh` 存在
2. 给 `deploy.sh` 添加执行权限
3. 写入 `/etc/default/<webhook-service>`（保存 `GITHUB_WEBHOOK_SECRET`）
4. 生成并启用 `/etc/systemd/system/<webhook-service>.service`
5. 输出 webhook 与应用服务状态
6. 自动注入 webhook 监听参数（host/port/path/target ref）

查看帮助：

```bash
bash scripts/auto_setup_webhook.sh --help
```

> 注意：脚本需要 root/sudo 权限；GitHub 仓库侧仍需手动配置 Webhook URL、push 事件与 Secret。

---

## 14. 一键自动化配置 Nginx 反代 + HTTPS（Webhook）

如果你希望把 `/github-webhook` 的 Nginx 反代与 HTTPS 一次完成，可使用：

```bash
cd /www/wwwroot/glowing-winner
sudo DOMAIN='your-domain.com' \
EMAIL='ops@your-domain.com' \
NGINX_CONF='/etc/nginx/conf.d/glowing-winner.conf' \
bash scripts/auto_setup_webhook_https.sh
```

脚本行为：

1. 备份原 Nginx 配置文件
2. 在指定 `server_name` 的 `server {}` 中注入 webhook location（幂等，可重复执行）
3. 执行 `nginx -t` 并 reload
4. 调用 `certbot --nginx` 申请/续签证书并启用 HTTPS 跳转

仅写反代、不申请证书（例如 DNS 还没解析好）：

```bash
sudo DOMAIN='your-domain.com' \
NGINX_CONF='/etc/nginx/conf.d/glowing-winner.conf' \
SKIP_CERTBOT=1 \
bash scripts/auto_setup_webhook_https.sh
```

查看帮助：

```bash
bash scripts/auto_setup_webhook_https.sh --help
```
