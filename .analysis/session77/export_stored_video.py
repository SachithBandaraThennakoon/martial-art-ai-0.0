import hashlib
import json
import sys
from pathlib import Path

from sqlalchemy import text


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from database import engine


OUTPUT = Path(__file__).parent / "session77.webm"
EXPECTED_SHA256 = "cf6a2fd78da14402359437fe8c5f57e77ea33946aa72183e2faf368c879fc022"

with engine.connect() as connection:
    row = connection.execute(
        text(
            "SELECT payload, duration_ms, byte_size, content_sha256 "
            "FROM practice_session_videos WHERE practice_session_id=77"
        )
    ).mappings().one()

payload = bytes(row["payload"])
actual_sha256 = hashlib.sha256(payload).hexdigest()
if actual_sha256 != EXPECTED_SHA256 or actual_sha256 != row["content_sha256"]:
    raise RuntimeError("Stored session 77 video failed its integrity check")

OUTPUT.write_bytes(payload)
print(
    json.dumps(
        {
            "path": str(OUTPUT),
            "bytes": len(payload),
            "database_bytes": row["byte_size"],
            "database_duration_ms": row["duration_ms"],
            "sha256": actual_sha256,
        },
        indent=2,
    )
)
