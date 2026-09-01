"""Local-only, admin-triggered database synchronization.

The browser never receives either database URL.  This router is deliberately
disabled unless a developer has opted in through environment variables.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_context import require_admin_user


router = APIRouter(prefix="/admin/database-sync", tags=["admin"])

LOCAL_DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
REMOTE_DATABASE_URL = os.getenv("DATABASE_SYNC_REMOTE_URL", "").strip()
SYNC_ENABLED = os.getenv("DATABASE_SYNC_ENABLED", "false").strip().lower() == "true"
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()


class DatabaseSyncRequest(BaseModel):
    direction: str
    confirmation: str


def _postgres_tool(name: str) -> str:
    executable = f"{name}.exe" if os.name == "nt" else name
    found = shutil.which(executable)
    if found:
        return found

    if os.name == "nt":
        root = Path(os.environ.get("ProgramFiles", r"C:\\Program Files")) / "PostgreSQL"
        candidates = sorted(root.glob(f"*/bin/{executable}"), reverse=True)
        if candidates:
            return str(candidates[0])
    raise HTTPException(
        status_code=503,
        detail=f"{name} is not installed. Install PostgreSQL client tools to use database sync.",
    )


def _run(args: list[str]) -> None:
    result = subprocess.run(args, capture_output=True, text=True, timeout=600, check=False)
    if result.returncode:
        message = (result.stderr or result.stdout or "Database command failed.").strip()
        raise RuntimeError(message[-1000:])


def _configuration_error() -> str | None:
    if APP_ENV == "production":
        return "Database sync is disabled in production. Run it from the local development backend."
    if not SYNC_ENABLED:
        return "Database sync is not enabled. Set DATABASE_SYNC_ENABLED=true in backend/.env."
    if not LOCAL_DATABASE_URL:
        return "DATABASE_URL is not configured."
    if not REMOTE_DATABASE_URL:
        return "DATABASE_SYNC_REMOTE_URL is not configured."
    if LOCAL_DATABASE_URL == REMOTE_DATABASE_URL:
        return "Local and remote database URLs must be different."
    return None


@router.get("/status")
def database_sync_status(_admin=Depends(require_admin_user)):
    error = _configuration_error()
    return {
        "available": error is None,
        "message": error or "Cloud database sync is ready.",
        "scope": "public schema only",
    }


@router.post("/run")
def run_database_sync(payload: DatabaseSyncRequest, _admin=Depends(require_admin_user)):
    error = _configuration_error()
    if error:
        raise HTTPException(status_code=503, detail=error)

    directions = {
        "cloud_to_local": (REMOTE_DATABASE_URL, LOCAL_DATABASE_URL, "cloud → local"),
        "local_to_cloud": (LOCAL_DATABASE_URL, REMOTE_DATABASE_URL, "local → cloud"),
    }
    if payload.direction not in directions:
        raise HTTPException(status_code=400, detail="Invalid sync direction.")
    if payload.confirmation.strip() != "SYNC":
        raise HTTPException(status_code=400, detail='Type "SYNC" to confirm this database replacement.')

    source_url, target_url, label = directions[payload.direction]
    pg_dump = _postgres_tool("pg_dump")
    pg_restore = _postgres_tool("pg_restore")
    psql = _postgres_tool("psql")

    with tempfile.TemporaryDirectory(prefix="xmartialart-db-sync-") as temp_dir:
        source_dump = str(Path(temp_dir) / "source.dump")
        target_backup = str(Path(temp_dir) / "target-before-sync.dump")
        try:
            # Keep a temporary rollback point until the restore has completed.
            _run([pg_dump, f"--dbname={target_url}", "--schema=public", "--format=custom", "--no-owner", "--no-acl", "--file", target_backup])
            _run([pg_dump, f"--dbname={source_url}", "--schema=public", "--format=custom", "--no-owner", "--no-acl", "--file", source_dump])

            # A schema replacement avoids failures from destination-only foreign keys.
            _run([psql, f"--dbname={target_url}", "--no-psqlrc", "--command=DROP SCHEMA public CASCADE;"])
            _run([pg_restore, f"--dbname={target_url}", "--clean", "--if-exists", "--no-owner", "--no-acl", "--exit-on-error", source_dump])
        except (OSError, subprocess.TimeoutExpired, RuntimeError) as exc:
            raise HTTPException(status_code=500, detail=f"Database sync failed: {exc}") from exc

    return {
        "message": f"Database sync completed ({label}).",
        "scope": "public schema only",
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
