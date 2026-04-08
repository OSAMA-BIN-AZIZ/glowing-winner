# 轻量级 Flask 博客系统（SQLite + Gunicorn + Nginx）

适用于 **1GB RAM Linux** 的个人博客/品牌展示站，功能专注、依赖少、维护简单。


## 部署文档

- 详细部署操作说明：`docs/DEPLOYMENT.md`

## 1) 项目结构

```text
blog/
├── app.py
├── config.py
├── requirements.txt
├── .gitignore
├── deploy.sh
├── blog.service
├── static/
│   ├── css/style.css
│   ├── js/admin.js
│   └── uploads/                 # 本地开发可用；生产建议改到外部目录
├── templates/
│   ├── base.html
│   ├── index.html
│   ├── blog_list.html
│   ├── blog_detail.html
│   ├── about.html
│   ├── contact.html
│   └── admin/
│       ├── login.html
│       ├── dashboard.html
│       └── post_form.html
└── static-demo/                 # GitHub Pages 静态演示版本
    ├── index.html
    ├── post.html
    ├── product.html
    ├── style.css
    └── demo.js
```

## 2) 功能列表

### 前台
- 首页
- 博客列表页
- 文章详情页
- About 页面
- Contact 页面
- SEO 基础字段：`title`、`meta description`、`slug`
- 封面图展示
- 发布时间展示

### 后台
- 管理员登录（密码哈希）
- 管理员账号设置（旧密码校验 + 强密码规则）
- 文章新增/编辑/删除
- 状态（草稿/已发布）
- slug 管理
- 封面图上传
- 正文图片上传（上传后返回 URL 可插入正文）
- 图片格式限制：jpg/jpeg/png/webp
- 文件下载管理（上传后生成随机下载地址）

## 3) 数据与上传目录设计（防止 git 更新覆盖）

生产环境请将以下目录放在代码目录外：

- 数据库：`/www/wwwdata/blog-data/blog.db`
- 上传目录：`/www/wwwdata/blog-data/uploads`

通过环境变量配置：

```bash
BLOG_DATA_DIR=/www/wwwdata/blog-data
BLOG_DB_NAME=blog.db
# 或直接指定完整路径（优先级更高）
# BLOG_DB_PATH=/www/wwwdata/blog-data/blog.db
BLOG_UPLOAD_DIR=/www/wwwdata/blog-data/uploads
```

> 不建议将数据库和上传目录放到 Git 仓库目录内，以免 `git reset --hard` 时被覆盖。

## 快速配置脚本（推荐）

项目根目录提供 `quick_setup.sh`，可一条命令生成 `.env`，并可选初始化数据库和管理员：

```bash
bash quick_setup.sh \
  --db-name blog_prod.db \
  --admin-user admin \
  --admin-pass 'StrongPass#2026' \
  --init-db --init-admin
```

仅查看参数帮助：

```bash
bash quick_setup.sh --help
```

> 注意：如果只执行 `bash quick_setup.sh`（未加 `--init-admin`），脚本只会写入 `.env`，不会把管理员写入数据库。  
> 这种情况下需要额外执行 `python3 -m flask --app app.py init-admin`（或 `flask --app app.py init-admin`）后，才能使用生成的账号密码登录后台。

## 4) 本地运行

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 初始化数据库
flask --app app.py init-db

# 初始化管理员（必须显式提供强密码）
INIT_ADMIN_USERNAME=admin INIT_ADMIN_PASSWORD='请替换为强密码' flask --app app.py init-admin
# 或使用部署环境变量
BLOG_ADMIN_USERNAME=admin BLOG_ADMIN_PASSWORD='请替换为强密码' flask --app app.py init-admin

# 开发运行
flask --app app.py run --debug
```

访问：`http://127.0.0.1:5000`

## 5) Gunicorn 启动命令（生产）

```bash
gunicorn -w 2 -b 127.0.0.1:8000 app:app
```

> 1GB RAM 推荐 2 workers。

## 6) Nginx 反向代理示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location /static/uploads/ {
        alias /www/wwwdata/blog-data/uploads/;
    }

    location /static/ {
        alias /www/wwwroot/blog/static/;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## 7) 首次生产部署步骤（aaPanel）

1. 在 aaPanel 创建 Python 项目目录：`/www/wwwroot/blog`
2. 克隆仓库到该目录。
3. 创建虚拟环境并安装依赖。
4. 创建外部数据目录：
   ```bash
   mkdir -p /www/wwwdata/blog-data/uploads
   chown -R www:www /www/wwwdata/blog-data
   ```
5. 配置 `.env`（必需，且必须包含强 `SECRET_KEY`）：
   ```env
   SECRET_KEY=replace-with-a-long-random-secret
   BLOG_DATA_DIR=/www/wwwdata/blog-data
   BLOG_DB_PATH=/www/wwwdata/blog-data/blog.db
   BLOG_UPLOAD_DIR=/www/wwwdata/blog-data/uploads
   ```
6. 执行数据库和管理员初始化。
7. 将 `blog.service` 放到 `/etc/systemd/system/blog.service` 后执行：
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable blog.service
   sudo systemctl start blog.service
   ```
8. 在 aaPanel/Nginx 面板中配置反向代理到 `127.0.0.1:8000`。

## 8) 自动部署（GitHub push -> aaPanel webhook）

### 推荐流程
1. 服务器上部署 webhook 接收器（aaPanel 提供的 webhook 或计划任务触发器）。
2. GitHub 仓库 `Settings -> Webhooks` 添加 webhook URL。
3. 仅监听 `push` 事件。
4. 条件：仅 main 分支触发。
5. webhook 执行命令：
   ```bash
   bash /www/wwwroot/blog/deploy.sh
   ```

### `deploy.sh` 做了什么
- 进入项目目录
- `git fetch + git reset --hard origin/main`
- 激活虚拟环境
- 安装/更新依赖
- 执行 `flask init-db`
- 重启 `systemd` 服务

## 9) systemd 服务文件

见项目根目录 `blog.service`。

## 10) GitHub Pages 静态演示版

目录：`static-demo/`

特性：
- 纯 HTML/CSS/JS
- 无后端依赖
- 页面：首页、文章详情页、产品页
- 使用假数据模拟内容
- 与 Flask 项目视觉风格保持一致

本地直接打开：
- `static-demo/index.html`

发布到 GitHub Pages：
- 选择仓库的 `main` 分支 `/static-demo` 目录（或拷贝到 Pages 入口目录）。

---

如需下一步，我可以继续帮你补充：
- `Nginx + SSL(Let's Encrypt)` 一键配置说明
- `GitHub Webhook 签名校验` 示例脚本（更安全）
- 简单防暴力登录与安全头配置

## 自动化部署快速配置（Webhook）

新增脚本：`scripts/auto_setup_webhook.sh`，用于一键配置 webhook 监听服务（systemd）并联动 `deploy.sh`。

示例：

```bash
cd /www/wwwroot/glowing-winner
sudo WEBHOOK_SECRET='请替换为强随机字符串' \
WEBHOOK_TARGET_REF='refs/heads/main' \
bash scripts/auto_setup_webhook.sh
```

详细说明见：`docs/DEPLOYMENT.md` 的“13. 一键自动化配置 Webhook（新增）”。

## 自动化配置 Nginx Webhook 反代 + HTTPS

新增脚本：`scripts/auto_setup_webhook_https.sh`，可自动把 `/github-webhook` 反代到本机 webhook 监听器并调用 certbot 配置 HTTPS。

```bash
cd /www/wwwroot/glowing-winner
sudo DOMAIN='your-domain.com' EMAIL='ops@your-domain.com' \
NGINX_CONF='/etc/nginx/conf.d/glowing-winner.conf' \
bash scripts/auto_setup_webhook_https.sh
```
