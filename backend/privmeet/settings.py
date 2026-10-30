"""All config comes from env vars so the same image runs on every tier."""

import os
from pathlib import Path

env = os.environ.get

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(env("DATA_DIR", BASE_DIR / "data"))
MEDIA_ROOT = DATA_DIR / "media"
MODELS_DIR = Path(env("MODELS_DIR", DATA_DIR / "models"))
DIARIZE_MODELS_DIR = Path(env("DIARIZE_MODELS_DIR", MODELS_DIR / "diarize"))
FRONTEND_DIST = Path(env("FRONTEND_DIST", BASE_DIR / "frontend_dist"))

SECRET_KEY = env("SECRET_KEY", "dev-insecure-change-me")
DEBUG = env("DEBUG") == "1"
ALLOWED_HOSTS = env("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
CSRF_TRUSTED_ORIGINS = env("CSRF_TRUSTED_ORIGINS", "http://localhost:5173").split(",")

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "meetings",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "privmeet.urls"
WSGI_APPLICATION = "privmeet.wsgi.application"
TEMPLATES = []

if env("POSTGRES_HOST"):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "HOST": env("POSTGRES_HOST"),
            "PORT": env("POSTGRES_PORT", "5432"),
            "NAME": env("POSTGRES_DB", "privmeet"),
            "USER": env("POSTGRES_USER", "privmeet"),
            "PASSWORD": env("POSTGRES_PASSWORD", ""),
            "CONN_MAX_AGE": 60,
        }
    }
else:
    # shortcut: SQLite for local dev/tests without Docker; search falls back to LIKE.
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": DATA_DIR / "db.sqlite3"}}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
TIME_ZONE = "UTC"

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [FRONTEND_DIST] if FRONTEND_DIST.is_dir() else []

MAX_UPLOAD_MB = int(env("MAX_UPLOAD_MB", "2048"))
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024  # bigger uploads stream to disk, not RAM

OLLAMA_URL = env("OLLAMA_URL", "http://localhost:11434")

CELERY_BROKER_URL = env("REDIS_URL", "redis://localhost:6379/0")
CELERY_TASK_ALWAYS_EAGER = env("CELERY_EAGER") == "1"
CELERY_TASK_IGNORE_RESULT = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}
