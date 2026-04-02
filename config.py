import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-me")

    DATA_DIR = os.getenv("BLOG_DATA_DIR", str(BASE_DIR / "instance"))
    DB_PATH = os.getenv("BLOG_DB_PATH", str(Path(DATA_DIR) / "blog.db"))
    UPLOAD_FOLDER = os.getenv("BLOG_UPLOAD_DIR", str(Path(DATA_DIR) / "uploads"))

    SQLALCHEMY_DATABASE_URI = f"sqlite:///{DB_PATH}"
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    MAX_CONTENT_LENGTH = 5 * 1024 * 1024
