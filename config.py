import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-me")
    DEBUG = env_bool("BLOG_DEBUG", True)
    SHOW_LOGIN_FAILURE_REASON = env_bool("BLOG_SHOW_LOGIN_FAILURE_REASON", DEBUG)

    DATA_DIR = os.getenv("BLOG_DATA_DIR", str(BASE_DIR / "instance"))
    DB_NAME = os.getenv("BLOG_DB_NAME", "blog.db")
    DB_PATH = os.getenv("BLOG_DB_PATH", str(Path(DATA_DIR) / DB_NAME))
    UPLOAD_FOLDER = os.getenv("BLOG_UPLOAD_DIR", str(Path(DATA_DIR) / "uploads"))

    SQLALCHEMY_DATABASE_URI = f"sqlite:///{DB_PATH}"
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    MAX_CONTENT_LENGTH = 5 * 1024 * 1024
