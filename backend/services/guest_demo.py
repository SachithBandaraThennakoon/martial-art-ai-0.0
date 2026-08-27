"""Create isolated, realistic demo data for browser guest sessions."""

from datetime import datetime, timedelta, timezone
import json
import secrets

from sqlalchemy.orm import Session

from models.body_calibration import BodyCalibration
from models.technique import Technique
from models.training_memory import (
    PracticeRep,
    PracticeSession,
    TrainingFeedbackEvent,
    TrainingSession,
)
from models.user import User
from utils.security import hash_password


GUEST_EMAIL_SUFFIX = "@guest.xmartialart.invalid"


def is_guest_user(user: User | None) -> bool:
    return bool(user and (user.email or "").lower().endswith(GUEST_EMAIL_SUFFIX))


def guest_email(browser_id: str) -> str:
    return f"demo-{browser_id}{GUEST_EMAIL_SUFFIX}"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def seed_guest_data(db: Session, user: User) -> None:
    if db.query(PracticeSession.id).filter(PracticeSession.user_id == user.id).first():
        return

    now = _utcnow()
    techniques = {
        row.name.lower(): row
        for row in db.query(Technique).filter(Technique.name.in_(["Jab", "Front Kick"])).all()
    }
    samples = [
        ("Jab", 12, 5, 5, 4, 82.4, 91.0, 86.0, "good", None),
        ("Jab", 7, 5, 4, 3, 74.8, 86.0, 77.0, "steady", "guard_recovery"),
        ("Front Kick", 3, 5, 3, 2, 69.5, 80.0, 71.0, "controlled", "balance"),
    ]
    for technique_name, days_ago, target, completed, clean, average, best, consistency, speed, issue in samples:
        technique = techniques.get(technique_name.lower())
        started = now - timedelta(days=days_ago, minutes=18)
        session = PracticeSession(
            user_id=user.id,
            technique_id=technique.id if technique else None,
            technique_name=technique_name,
            step_key="demo-complete",
            step_name="Full movement",
            target_reps=target,
            completed_reps=completed,
            clean_reps=clean,
            average_accuracy=average,
            best_accuracy=best,
            average_rep_seconds=2.1,
            consistency_score=consistency,
            status="completed",
            started_at=started,
            ended_at=started + timedelta(minutes=4),
        )
        db.add(session)
        db.flush()
        for rep_number in range(1, completed + 1):
            rep_accuracy = min(100, average - 4 + rep_number * 1.6)
            db.add(PracticeRep(
                practice_session_id=session.id,
                rep_number=rep_number,
                accuracy=rep_accuracy,
                duration_ms=1850 + rep_number * 90,
                speed_label=speed,
                quality_label="clean" if rep_number <= clean else "review",
                focus_body_part="guard" if issue else "whole_body",
                issue=issue if rep_number > clean else "good",
                started_at=started + timedelta(seconds=rep_number * 25),
                ended_at=started + timedelta(seconds=rep_number * 25 + 2),
            ))

    jab = techniques.get("jab")
    training_started = now - timedelta(days=1, minutes=25)
    training = TrainingSession(
        user_id=user.id,
        technique_id=jab.id if jab else None,
        technique_name="Jab",
        mode="train",
        started_at=training_started,
        ended_at=training_started + timedelta(minutes=8),
        final_accuracy=88.0,
        completed=True,
    )
    db.add(training)
    db.flush()
    db.add_all([
        TrainingFeedbackEvent(
            session_id=training.id,
            step_key="guard",
            body_part="wrist_left",
            issue="guard_low",
            feedback_text="Bring the lead hand back to guard after extension.",
            accuracy=76,
            created_at=training_started + timedelta(minutes=2),
        ),
        TrainingFeedbackEvent(
            session_id=training.id,
            step_key="extension",
            body_part="elbow_left",
            issue="complete",
            feedback_text="Good extension with a relaxed shoulder.",
            accuracy=91,
            created_at=training_started + timedelta(minutes=6),
        ),
    ])
    db.add(BodyCalibration(
        user_id=user.id,
        ratios_json=json.dumps({
            "shoulder_width": 0.98,
            "torso_length": 1.04,
            "upper_arm_left": 0.63,
            "upper_arm_right": 0.62,
            "forearm_left": 0.57,
            "forearm_right": 0.58,
        }),
        sample_count=48,
        stability_score=91.0,
    ))


def get_or_create_guest(db: Session, browser_id: str | None) -> tuple[User, str]:
    normalized_id = (browser_id or "").strip().lower()
    if not normalized_id or len(normalized_id) > 64 or not normalized_id.replace("-", "").isalnum():
        normalized_id = secrets.token_urlsafe(18).lower().replace("_", "-")
    email = guest_email(normalized_id)
    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(
            name="Guest Demo",
            email=email,
            password_hash=hash_password(secrets.token_urlsafe(32)),
            role="user",
            plan="ELITE_PLAN",
            subscription_status="trial",
            trial_ends_at=(_utcnow() + timedelta(days=1)).replace(tzinfo=None),
        )
        db.add(user)
        db.flush()
        seed_guest_data(db, user)
    else:
        # Keep returning visitors in the complete demo experience while
        # preserving the practice progress they added in this browser.
        user.plan = "ELITE_PLAN"
        user.subscription_status = "trial"
        user.trial_ends_at = (_utcnow() + timedelta(days=1)).replace(tzinfo=None)
    return user, normalized_id
