"""Create and migrate a clean local PostgreSQL database without deleting the old one."""

import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import re
import shutil

from alembic import command
from alembic.config import Config
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import URL, make_url


BACKEND_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = BACKEND_ROOT / ".env"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}

load_dotenv(ENV_PATH)


def clean_database_name(current_name: str, timestamp: str | None = None) -> str:
    suffix = timestamp or datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", current_name or "martial_art_ai")
    return f"{safe_name}_clean_{suffix}"[:63]


def require_local_postgres(database_url: str) -> URL:
    url = make_url(database_url)
    if not url.drivername.startswith("postgresql"):
        raise RuntimeError("This recovery command only supports PostgreSQL.")
    if (url.host or "").lower() not in LOCAL_HOSTS:
        raise RuntimeError(
            "Refusing to create a database on a non-local PostgreSQL host. "
            "Use the reviewed production migration workflow instead."
        )
    return url


def replace_database_url(env_text: str, database_url: str) -> str:
    replacement = f"DATABASE_URL={database_url}"
    pattern = re.compile(r"(?m)^DATABASE_URL=.*$")
    if pattern.search(env_text):
        return pattern.sub(lambda _: replacement, env_text, count=1)
    separator = "" if not env_text or env_text.endswith(("\n", "\r")) else "\n"
    return f"{env_text}{separator}{replacement}\n"


def set_process_database_url(database_url: str):
    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = database_url
    return previous


def restore_process_database_url(previous: str | None) -> None:
    if previous is None:
        os.environ.pop("DATABASE_URL", None)
    else:
        os.environ["DATABASE_URL"] = previous


def create_database(admin_url: URL, database_name: str) -> None:
    engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            quoted_name = connection.dialect.identifier_preparer.quote(database_name)
            connection.exec_driver_sql(f"CREATE DATABASE {quoted_name}")
    finally:
        engine.dispose()


def drop_database(admin_url: URL, database_name: str) -> None:
    engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            quoted_name = connection.dialect.identifier_preparer.quote(database_name)
            connection.exec_driver_sql(f"DROP DATABASE IF EXISTS {quoted_name}")
    finally:
        engine.dispose()


def migrate_database(database_url: str) -> None:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    previous = set_process_database_url(database_url)
    try:
        command.upgrade(config, "head")
        command.check(config)
    finally:
        restore_process_database_url(previous)


def activate_database(database_url: str) -> Path:
    current_text = ENV_PATH.read_text(encoding="utf-8") if ENV_PATH.exists() else ""
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_path = ENV_PATH.with_name(f".env.backup-{timestamp}")
    if ENV_PATH.exists():
        shutil.copy2(ENV_PATH, backup_path)
    ENV_PATH.write_text(replace_database_url(current_text, database_url), encoding="utf-8")
    return backup_path


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Create a clean sibling development database, migrate it to head, "
            "and preserve the current database unchanged."
        )
    )
    parser.add_argument("--confirm", action="store_true", help="Create the new database.")
    parser.add_argument(
        "--activate",
        action="store_true",
        help="After successful migration, back up .env and switch DATABASE_URL.",
    )
    parser.add_argument("--name", help="Optional new database name.")
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise SystemExit("DATABASE_URL is required.")

    try:
        current_url = require_local_postgres(database_url)
        database_name = args.name or clean_database_name(current_url.database or "martial_art_ai")
        target_url = current_url.set(database=database_name)
        admin_url = current_url.set(database="postgres")
    except RuntimeError as exc:
        raise SystemExit(str(exc)) from exc

    if not args.confirm:
        print(f"Would create and migrate: {target_url.render_as_string(hide_password=True)}")
        print("The current database would remain untouched. Rerun with --confirm.")
        return

    create_database(admin_url, database_name)
    try:
        migrate_database(target_url.render_as_string(hide_password=False))
    except Exception:
        drop_database(admin_url, database_name)
        raise

    print(f"Created and migrated: {target_url.render_as_string(hide_password=True)}")
    print("The previous database remains unchanged.")
    if args.activate:
        backup_path = activate_database(target_url.render_as_string(hide_password=False))
        print(f"Activated the new database in {ENV_PATH}.")
        if backup_path.exists():
            print(f"Previous environment file backed up to {backup_path}.")
    else:
        print("Rerun with --confirm --activate to switch backend/.env after another review.")


if __name__ == "__main__":
    main()
