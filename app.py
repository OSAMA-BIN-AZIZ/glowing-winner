import os
import re
import uuid
from datetime import datetime
from functools import wraps
from pathlib import Path

from flask import (
    Flask,
    flash,
    redirect,
    render_template,
    request,
    session,
    send_from_directory,
    url_for,
)
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import desc
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

from config import Config


db = SQLAlchemy()

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}


class Admin(db.Model):
    __tablename__ = "admins"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class Post(db.Model):
    __tablename__ = "posts"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    slug = db.Column(db.String(220), unique=True, nullable=False, index=True)
    meta_description = db.Column(db.String(255), default="", nullable=False)
    content = db.Column(db.Text, nullable=False)
    cover_image = db.Column(db.String(255), default="", nullable=False)
    status = db.Column(db.String(20), default="draft", nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    @property
    def is_published(self) -> bool:
        return self.status == "published"


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)

    db.init_app(app)

    Path(app.config["DATA_DIR"]).mkdir(parents=True, exist_ok=True)
    Path(app.config["UPLOAD_FOLDER"]).mkdir(parents=True, exist_ok=True)

    @app.cli.command("init-db")
    def init_db_command():
        db.create_all()
        print("Database initialized.")

    @app.cli.command("init-admin")
    def init_admin_command():
        username = os.getenv("INIT_ADMIN_USERNAME") or os.getenv("BLOG_ADMIN_USERNAME", "admin")
        password = os.getenv("INIT_ADMIN_PASSWORD") or os.getenv("BLOG_ADMIN_PASSWORD")

        if not password:
            raise RuntimeError(
                "INIT_ADMIN_PASSWORD is required. Refusing to create admin with a default password."
            )

        if Admin.query.filter_by(username=username).first():
            print(f"Admin '{username}' already exists.")
            return

        admin = Admin(username=username, password_hash=generate_password_hash(password))
        db.session.add(admin)
        db.session.commit()
        print(f"Admin created: {username}")

    def login_required(view_func):
        @wraps(view_func)
        def wrapped(*args, **kwargs):
            if not session.get("admin_id"):
                flash("请先登录后台。", "warning")
                return redirect(url_for("admin_login"))
            return view_func(*args, **kwargs)

        return wrapped

    def slugify(value: str) -> str:
        slug = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fa5\s-]", "", value).strip().lower()
        slug = re.sub(r"[\s_-]+", "-", slug)
        return slug or f"post-{uuid.uuid4().hex[:8]}"

    def allowed_file(filename: str) -> bool:
        return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

    def build_upload_name(filename: str) -> str:
        ext = filename.rsplit(".", 1)[1].lower()
        return f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}.{ext}"

    @app.context_processor
    def inject_now():
        return {"now": datetime.utcnow()}

    @app.route("/static/uploads/<path:filename>")
    def uploaded_file(filename):
        return send_from_directory(app.config["UPLOAD_FOLDER"], filename)

    @app.route("/")
    def home():
        posts = (
            Post.query.filter_by(status="published")
            .order_by(desc(Post.created_at))
            .limit(6)
            .all()
        )
        return render_template("index.html", posts=posts)

    @app.route("/blog")
    def blog_list():
        posts = Post.query.filter_by(status="published").order_by(desc(Post.created_at)).all()
        return render_template("blog_list.html", posts=posts)

    @app.route("/blog/<slug>")
    def blog_detail(slug):
        post = Post.query.filter_by(slug=slug, status="published").first_or_404()
        seo_title = post.title
        seo_description = post.meta_description or post.content[:150]
        return render_template(
            "blog_detail.html", post=post, seo_title=seo_title, seo_description=seo_description
        )

    @app.route("/about")
    def about():
        return render_template("about.html")

    @app.route("/contact")
    def contact():
        return render_template("contact.html")

    @app.route("/admin/login", methods=["GET", "POST"])
    def admin_login():
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            admin = Admin.query.filter_by(username=username).first()

            if admin and check_password_hash(admin.password_hash, password):
                session["admin_id"] = admin.id
                flash("登录成功。", "success")
                return redirect(url_for("admin_dashboard"))

            flash("用户名或密码错误。", "danger")

        return render_template("admin/login.html")

    @app.route("/admin/logout")
    @login_required
    def admin_logout():
        session.clear()
        flash("已退出登录。", "info")
        return redirect(url_for("admin_login"))

    @app.route("/admin")
    @login_required
    def admin_dashboard():
        posts = Post.query.order_by(desc(Post.created_at)).all()
        return render_template("admin/dashboard.html", posts=posts)

    @app.route("/admin/posts/new", methods=["GET", "POST"])
    @login_required
    def admin_post_create():
        if request.method == "POST":
            title = request.form.get("title", "").strip()
            slug = request.form.get("slug", "").strip() or slugify(title)
            meta_description = request.form.get("meta_description", "").strip()
            content = request.form.get("content", "").strip()
            status = request.form.get("status", "draft")

            if not title or not content:
                flash("标题和正文不能为空。", "warning")
                return render_template("admin/post_form.html", post=None)

            if Post.query.filter_by(slug=slug).first():
                flash("Slug 已存在，请修改。", "warning")
                return render_template("admin/post_form.html", post=None)

            cover_image = ""
            cover_file = request.files.get("cover_image")
            if cover_file and cover_file.filename:
                if not allowed_file(cover_file.filename):
                    flash("封面图格式不支持，仅支持 jpg/jpeg/png/webp。", "warning")
                    return render_template("admin/post_form.html", post=None)
                filename = build_upload_name(secure_filename(cover_file.filename))
                cover_file.save(os.path.join(app.config["UPLOAD_FOLDER"], filename))
                cover_image = filename

            post = Post(
                title=title,
                slug=slug,
                meta_description=meta_description,
                content=content,
                status=status if status in {"draft", "published"} else "draft",
                cover_image=cover_image,
            )
            db.session.add(post)
            db.session.commit()
            flash("文章创建成功。", "success")
            return redirect(url_for("admin_dashboard"))

        return render_template("admin/post_form.html", post=None)

    @app.route("/admin/posts/<int:post_id>/edit", methods=["GET", "POST"])
    @login_required
    def admin_post_edit(post_id):
        post = Post.query.get_or_404(post_id)

        if request.method == "POST":
            title = request.form.get("title", "").strip()
            slug = request.form.get("slug", "").strip() or slugify(title)
            meta_description = request.form.get("meta_description", "").strip()
            content = request.form.get("content", "").strip()
            status = request.form.get("status", "draft")

            if not title or not content:
                flash("标题和正文不能为空。", "warning")
                return render_template("admin/post_form.html", post=post)

            existing = Post.query.filter_by(slug=slug).first()
            if existing and existing.id != post.id:
                flash("Slug 已存在，请修改。", "warning")
                return render_template("admin/post_form.html", post=post)

            cover_file = request.files.get("cover_image")
            if cover_file and cover_file.filename:
                if not allowed_file(cover_file.filename):
                    flash("封面图格式不支持，仅支持 jpg/jpeg/png/webp。", "warning")
                    return render_template("admin/post_form.html", post=post)
                filename = build_upload_name(secure_filename(cover_file.filename))
                cover_file.save(os.path.join(app.config["UPLOAD_FOLDER"], filename))
                post.cover_image = filename

            post.title = title
            post.slug = slug
            post.meta_description = meta_description
            post.content = content
            post.status = status if status in {"draft", "published"} else "draft"

            db.session.commit()
            flash("文章更新成功。", "success")
            return redirect(url_for("admin_dashboard"))

        return render_template("admin/post_form.html", post=post)

    @app.route("/admin/posts/<int:post_id>/delete", methods=["POST"])
    @login_required
    def admin_post_delete(post_id):
        post = Post.query.get_or_404(post_id)
        db.session.delete(post)
        db.session.commit()
        flash("文章已删除。", "info")
        return redirect(url_for("admin_dashboard"))

    @app.route("/admin/upload-image", methods=["POST"])
    @login_required
    def admin_upload_image():
        image = request.files.get("image")
        if not image or not image.filename:
            return {"ok": False, "message": "未选择文件"}, 400

        if not allowed_file(image.filename):
            return {"ok": False, "message": "仅支持 jpg/jpeg/png/webp"}, 400

        filename = build_upload_name(secure_filename(image.filename))
        image.save(os.path.join(app.config["UPLOAD_FOLDER"], filename))
        return {"ok": True, "url": url_for("uploaded_file", filename=filename)}, 200

    with app.app_context():
        db.create_all()

    return app


app = create_app()


if __name__ == "__main__":
    app.run(debug=True)
