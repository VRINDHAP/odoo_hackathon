from logging.config import fileConfig
from pathlib import Path
import os

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.pool import NullPool

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Load local database credentials.
env_file = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(env_file)

password = os.getenv("POSTGRES_PASSWORD")
if not password:
    raise RuntimeError("POSTGRES_PASSWORD is missing from database/.env")

# Connect through PgBouncer.
database_url = URL.create(
    "postgresql+psycopg",
    username="brightloop_user",
    password=password,
    host="127.0.0.1",
    port=6432,
    database="brightloop_db",
)

target_metadata = None


def run_migrations_offline():
    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = create_engine(
        database_url,
        poolclass=NullPool,
    )

    try:
        with connectable.connect() as connection:
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
            )

            with context.begin_transaction():
                context.run_migrations()
    finally:
        connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
