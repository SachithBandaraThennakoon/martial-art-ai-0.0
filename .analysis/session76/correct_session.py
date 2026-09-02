import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from database import engine


SESSION_ID = 76
USER_ID = 5
VIDEO_SHA256 = "9b846126ec6cb349b47d84f9c86fc90641b09c48c31053821c81094c311f0b96"
ACTUAL_VIDEO_DURATION_MS = 14_576
MANUALLY_VERIFIED_REPS = 5


with engine.begin() as connection:
    session = connection.execute(
        text(
            "SELECT id, user_id, target_reps, completed_reps, clean_reps, status "
            "FROM practice_sessions WHERE id=:id AND user_id=:user_id"
        ),
        {"id": SESSION_ID, "user_id": USER_ID},
    ).mappings().one()
    video = connection.execute(
        text(
            "SELECT duration_ms, content_sha256 FROM practice_session_videos "
            "WHERE practice_session_id=:id"
        ),
        {"id": SESSION_ID},
    ).mappings().one()
    analytics_row = connection.execute(
        text(
            "SELECT payload FROM practice_session_analytics "
            "WHERE practice_session_id=:id"
        ),
        {"id": SESSION_ID},
    ).mappings().one()

    if video["content_sha256"] != VIDEO_SHA256:
        raise RuntimeError("Stored video does not match the manually reviewed recording")

    analytics = json.loads(analytics_row["payload"])
    previous = {
        "completed_reps": session["completed_reps"],
        "status": session["status"],
        "video_duration_ms": video["duration_ms"],
        "analytics_completed_repetitions": analytics.get("completed_repetitions"),
        "completion_source": analytics.get("completion_source"),
    }
    evidence = dict(analytics.get("completion_evidence") or {})
    evidence.update(
        {
            "canonical_session": MANUALLY_VERIFIED_REPS,
            "manual_video_review": MANUALLY_VERIFIED_REPS,
        }
    )
    analytics.update(
        {
            "source": "manual_video_review",
            "machine_analysis_source": "post_session_rule_engine",
            "completion_source": "manual_video_review",
            "completed_repetitions": MANUALLY_VERIFIED_REPS,
            "aborted_repetitions": 0,
            "completion_evidence": evidence,
            "manual_review": {
                "status": "verified",
                "reviewed_at": datetime.now(timezone.utc).isoformat(),
                "basis": "stored_raw_video",
                "observed_repetitions": MANUALLY_VERIFIED_REPS,
                "numeric_form_score_verified": False,
                "actual_video_duration_ms": ACTUAL_VIDEO_DURATION_MS,
                "video_sha256": video["content_sha256"],
                "previous_machine_result": previous,
            },
        }
    )

    session_update = connection.execute(
        text(
            "UPDATE practice_sessions SET completed_reps=:reps, status='completed' "
            "WHERE id=:id AND user_id=:user_id"
        ),
        {"reps": MANUALLY_VERIFIED_REPS, "id": SESSION_ID, "user_id": USER_ID},
    )
    video_update = connection.execute(
        text(
            "UPDATE practice_session_videos SET duration_ms=:duration_ms "
            "WHERE practice_session_id=:id AND content_sha256=:sha256"
        ),
        {
            "duration_ms": ACTUAL_VIDEO_DURATION_MS,
            "id": SESSION_ID,
            "sha256": VIDEO_SHA256,
        },
    )
    analytics_update = connection.execute(
        text(
            "UPDATE practice_session_analytics SET payload=:payload "
            "WHERE practice_session_id=:id"
        ),
        {
            "payload": json.dumps(analytics, separators=(",", ":"), ensure_ascii=False),
            "id": SESSION_ID,
        },
    )
    if (session_update.rowcount, video_update.rowcount, analytics_update.rowcount) != (1, 1, 1):
        raise RuntimeError("Correction target changed before the transaction completed")

with engine.connect() as connection:
    after = connection.execute(
        text(
            "SELECT completed_reps, target_reps, clean_reps, status "
            "FROM practice_sessions WHERE id=:id"
        ),
        {"id": SESSION_ID},
    ).mappings().one()
    video_duration = connection.execute(
        text(
            "SELECT duration_ms FROM practice_session_videos "
            "WHERE practice_session_id=:id"
        ),
        {"id": SESSION_ID},
    ).scalar_one()
    analytics = json.loads(
        connection.execute(
            text(
                "SELECT payload FROM practice_session_analytics "
                "WHERE practice_session_id=:id"
            ),
            {"id": SESSION_ID},
        ).scalar_one()
    )

print(
    json.dumps(
        {
            "before": previous,
            "after": {
                **dict(after),
                "video_duration_ms": video_duration,
                "completion_source": analytics.get("completion_source"),
                "analytics_completed_repetitions": analytics.get("completed_repetitions"),
                "numeric_form_score_verified": analytics.get("manual_review", {}).get(
                    "numeric_form_score_verified"
                ),
            },
        },
        indent=2,
        default=str,
    )
)
