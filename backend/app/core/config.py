"""
Application Configuration Module using Pydantic Settings.
Loads environment variables with robust defaults for local and containerized execution.
"""
from typing import List
import os
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "Brightloop Subscription Management System"
    API_V1_STR: str = "/api/v1"
    DEBUG: bool = False

    # Relational Database URL (PostgreSQL by default, graceful SQLite fallback for isolated unit tests)
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://postgres:postgres@localhost:5432/brightloop"
    )
    SQLITE_FALLBACK_URL: str = "sqlite:///./brightloop.db"

    # JWT Authentication & Tokens [PDF 9]
    JWT_SECRET: str = os.getenv("JWT_SECRET", "brightloop-secret-key-odoo-hackathon-2026-very-secure")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15  # 15 minutes [PDF 9]
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7     # 7 days rotating refresh token [PDF 9]
    PASSWORD_RESET_TOKEN_EXPIRE_MINUTES: int = 30  # 30 minutes [PDF 9]

    # Security & Lockout [PDF 5.1, 9]
    MAX_FAILED_LOGIN_ATTEMPTS: int = 5
    ACCOUNT_LOCKOUT_MINUTES: int = 15

    # Redis Cache & Queue [PDF 3, 11]
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    REDIS_CACHE_TTL_SECONDS: int = 180  # 3 minutes cache for KPI summary [PDF 11]

    # CORS Configuration
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        "*"
    ]

    # Business Defaults [PDF 5]
    DEFAULT_CURRENCY: str = "INR"
    INVOICE_PREFIX: str = "INV-2026-"
    SUBSCRIPTION_PREFIX: str = "SUB-2026-"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )


settings = Settings()
