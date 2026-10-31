"""
Database Session and Engine Management.
Provides SQLAlchemy connection pooling, DeclarativeBase, and per-request session dependency.
Notice: The physical schema, migrations (Alembic), and PostgreSQL containers are owned by Sooraj (/database).
This module merely creates the application connection client to communicate with that relational database.
"""
import logging
from typing import Generator
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from app.core.config import settings

logger = logging.getLogger(__name__)

# Determine active database URL and engine options
active_db_url = settings.DATABASE_URL
engine_kwargs = {"pool_pre_ping": True}

if active_db_url.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    engine_kwargs["pool_size"] = 10
    engine_kwargs["max_overflow"] = 20
    engine_kwargs["pool_recycle"] = 3600

# Try creating engine for primary database; fallback to SQLite if PostgreSQL is unavailable locally
try:
    engine = create_engine(active_db_url, **engine_kwargs)
    # Quick probe to verify if host is reachable
    with engine.connect() as probe:
        probe.execute(text("SELECT 1"))
    logger.info(f"Connected to primary database: {active_db_url.split('@')[-1] if '@' in active_db_url else active_db_url}")
except Exception as exc:
    logger.warning(
        f"Primary database connection ({active_db_url}) not reachable yet: {exc}. "
        f"Switching to SQLite fallback ({settings.SQLITE_FALLBACK_URL}) for local dev/testing."
    )
    active_db_url = settings.SQLITE_FALLBACK_URL
    engine = create_engine(
        active_db_url,
        connect_args={"check_same_thread": False}
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency yielding a clean database session per request.
    Closes the session automatically upon request completion.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_db_connection() -> bool:
    """
    Verifies that the database engine can successfully execute a query.
    Used by health checks.
    """
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        logger.error(f"Health probe database check failed: {e}")
        return False
