import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from database import engine


SESSION_ID = 77
USER_ID = 5
VIDEO_SHA256 = "cf6a2fd78da14402359437fe8c5f57e77ea33946aa72183e2faf368c879fc022"
MANUALLY_VERIFIED_REPS = 5


with engine.begin() as connection:
    session = connection.execute(
        text(
            "SELECT completed_reps, target_reps, clean_reps, average_accuracy, "
            "best_accuracy, average_rep_seconds, consistency_score, status "
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
    reps = connection.execute(
        text(
            "SELECT rep_number, accuracy, duration_ms FROM practice_reps "
            "WHERE practice_session_id=:id ORDER BY rep_number"
        ),
        {"id": SESSION_ID},
    ).mappings().all()
    analytics_row = connection.execute(
        text(
            "SELECT payload FROM practice_session_analytics "
            "WHERE practice_session_id=:id"
        ),
        {"id": SESSION_ID},
    ).mappings().one()

    if video["content_sha256"] != VIDEO_SHA256:
        raise RuntimeError("Stored video does not match the manually reviewed recording")
    if len(reps) != 3:
        raise RuntimeError("Expected exactly three machine-scored reps before correction")

    scores = [float(rep["accuracy"]) for rep in reps]
    durations = [int(rep["duration_ms"]) for rep in reps]
    average_accuracy = sum(scores) / len(scores)
    variance = sum((score - average_accuracy) ** 2 for score in scores) / len(scores)
    consistency = max(0, min(100, 100 - math.sqrt(variance)))
    average_rep_seconds = sum(durations) / len(durations) / 1000

    analytics = json.loads(analytics_row["payload"])
    previous = {
        **dict(session),
        "analytics_completed_repetitions": analytics.get("completed_repetitions"),
        "completion_source": analytics.get("completion_source"),
    }
    evidence = dict(analytics.get("completion_evidence") or {})
    evidence.update(
        {
            "persisted_scored_reps": len(reps),
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
            "scored_repetitions": len(reps),
            "aborted_repetitions": 0,
            "completion_evidence": evidence,
            "manual_review": {
                "status": "verified",
                "reviewed_at": datetime.now(timezone.utc).isoformat(),
                "basis": "stored_raw_video",
                "observed_repetitions": MANUALLY_VERIFIED_REPS,
                "machine_scored_repetitions": len(reps),
                "numeric_form_score_verified": False,
                "actual_video_duration_ms": video["duration_ms"],
                "video_sha256": video["content_sha256"],
                "previous_machine_result": previous,
            },
        }
    )

    session_update = connection.execute(
        text(
            "UPDATE practice_sessions SET completed_reps=:completed_reps, "
            "clean_reps=:clean_reps, average_accuracy=:average_accuracy, "
            "best_accuracy=:best_accuracy, average_rep_seconds=:average_rep_seconds, "
            "consistency_score=:consistency_score, status='completed' "
            "WHERE id=:id AND user_id=:user_id"
        ),
        {
            "completed_reps": MANUALLY_VERIFIED_REPS,
            "clean_reps": sum(score >= 80 for score in scores),
            "average_accuracy": average_accuracy,
            "best_accuracy": max(scores),
            "average_rep_seconds": average_rep_seconds,
            "consistency_score": consistency,
            "id": SESSION_ID,
            "user_id": USER_ID,
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
    if (session_update.rowcount, analytics_update.rowcount) != (1, 1):
        raise RuntimeError("Correction target changed before the transaction completed")

with engine.connect() as connection:
    after = connection.execute(
        text(
            "SELECT completed_reps, target_reps, clean_reps, average_accuracy, "
            "best_accuracy, average_rep_seconds, consistency_score, status "
            "FROM practice_sessions WHERE id=:id"
        ),
        {"id": SESSION_ID},
    ).mappings().one()

print(json.dumps({"before": previous, "after": dict(after)}, indent=2, default=str))
