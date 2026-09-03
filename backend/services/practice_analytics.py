import json
import zlib


ANALYTICS_SCHEMA_VERSION = 6


def _number(value, default=0):
    try:
        result = float(value)
        return result if result == result else default
    except (TypeError, ValueError):
        return default


def _integer(value, default=0):
    return int(round(_number(value, default)))


def _acp_forecast_summary(metadata):
    source = metadata.get("acpForecastSummary")
    if not isinstance(source, dict):
        return None

    reliability = source.get("band_reliability")
    reliability = reliability if isinstance(reliability, dict) else {}
    return {
        "model_name": str(source.get("model_name") or "ACP-STGAT")[:80],
        "role": "advisory_only",
        "affects_rep_count": False,
        "observed_samples": max(0, _integer(source.get("observed_samples"))),
        "forecast_samples": max(0, _integer(source.get("forecast_samples"))),
        "coverage_percentage": max(
            0, min(100, round(_number(source.get("coverage_percentage")), 1))
        ),
        "bands": {
            "level1": "frames 1-6",
            "level2": "frames 1-12",
            "awareness": "frames 4-12",
            "level3": "frames 1-30",
        },
        "band_reliability": {
            name: (
                max(0, min(1, round(_number(reliability.get(name)), 3)))
                if reliability.get(name) is not None else None
            )
            for name in ("level1", "level2", "awareness", "level3")
        },
        "dominant_intent": str(source.get("dominant_intent") or "unavailable")[:80],
        "dominant_transition": str(
            source.get("dominant_transition") or "unavailable"
        )[:80],
        "transition_candidates": max(
            0, _integer(source.get("transition_candidates"))
        ),
        "trusted_warning_samples": max(
            0, _integer(source.get("trusted_warning_samples"))
        ),
        "peak_warning_risk": max(
            0, min(1, round(_number(source.get("peak_warning_risk")), 3))
        ),
    }


def extract_practice_analytics(metadata):
    metadata = metadata if isinstance(metadata, dict) else {}
    rule_analysis = metadata.get("ruleEngineAnalysis")
    rule_analysis = rule_analysis if isinstance(rule_analysis, dict) else {}
    rule_summary = rule_analysis.get("summary")
    rule_summary = rule_summary if isinstance(rule_summary, dict) else {}
    corrected = metadata.get("correctedSummary")
    corrected = corrected if isinstance(corrected, dict) else {}

    errors = []
    for item in rule_summary.get("common_form_errors") or []:
        if isinstance(item, dict) and item.get("error_id"):
            errors.append({
                "error_id": str(item["error_id"])[:120],
                "count": max(0, _integer(item.get("count"))),
            })

    step_durations = {
        str(key)[:120]: max(0, _integer(value))
        for key, value in (rule_summary.get("per_step_duration_ms") or {}).items()
        if isinstance(key, (str, int))
    }

    post_session_completed = corrected.get("completed_reps")
    strict_completed = rule_summary.get("completed_repetitions")
    canonical_completed = metadata.get("canonicalCompletedReps")
    completion_candidates = [
        ("post_session_cluster", post_session_completed),
        ("strict_rule_engine", strict_completed),
        ("canonical_session", canonical_completed),
    ]
    available_completion_candidates = [
        (source, max(0, _integer(value)))
        for source, value in completion_candidates
        if value is not None
    ]
    is_rule_v2 = (
        str(rule_summary.get("analysis_schema_version") or "") == "2.0"
        or rule_summary.get("detected_attempts") is not None
    )
    if is_rule_v2:
        completion_source = "rule_engine_v2"
        detected_attempts = max(0, _integer(rule_summary.get("detected_attempts")))
        completed_motions = max(
            0,
            _integer(
                rule_summary.get(
                    "completed_motions",
                    rule_summary.get("completed_repetitions"),
                )
            ),
        )
        # Keep the historical field as the performed-repetition count so older
        # dashboard clients receive the same authoritative v2 value.
        completed_repetitions = detected_attempts
    else:
        completion_source, corrected_completed = max(
            available_completion_candidates,
            key=lambda item: item[1],
            default=("unavailable", 0),
        )
        completed_repetitions = max(0, _integer(corrected_completed))
        detected_attempts = completed_repetitions
        completed_motions = max(0, _integer(strict_completed, completed_repetitions))
    target_repetitions = metadata.get(
        "canonicalTargetReps",
        metadata.get("targetReps"),
    )
    if is_rule_v2:
        aborted_repetitions = max(
            0,
            _integer(rule_summary.get("aborted_repetitions")),
            detected_attempts - completed_motions,
            _integer(target_repetitions) - completed_motions
            if target_repetitions is not None else 0,
        )
    else:
        aborted_repetitions = (
            max(0, _integer(target_repetitions) - completed_repetitions)
            if target_repetitions is not None
            else max(0, _integer(rule_summary.get("aborted_repetitions")))
        )

    tracking_quality_percentage = rule_summary.get("tracking_quality_percentage")
    if tracking_quality_percentage is None and rule_summary.get("tracking_quality") is not None:
        tracking_quality_percentage = _number(rule_summary.get("tracking_quality")) * 100

    return {
        "schema_version": ANALYTICS_SCHEMA_VERSION,
        "source": "post_session_rule_engine",
        "completion_source": completion_source,
        "completed_repetitions": completed_repetitions,
        "detected_attempts": detected_attempts,
        "completed_motions": completed_motions,
        "analysis_schema_version": (
            str(rule_summary.get("analysis_schema_version"))
            if is_rule_v2 else None
        ),
        "technique_quality": (
            max(0, min(1, _number(rule_summary.get("technique_quality"))))
            if rule_summary.get("technique_quality") is not None else None
        ),
        "detection_confidence": (
            max(0, min(1, _number(rule_summary.get("detection_confidence"))))
            if rule_summary.get("detection_confidence") is not None else None
        ),
        "consistency": (
            max(0, min(1, _number(rule_summary.get("consistency"))))
            if rule_summary.get("consistency") is not None else None
        ),
        "completion_evidence": {
            "post_session_cluster": (
                max(0, _integer(post_session_completed))
                if post_session_completed is not None
                else None
            ),
            "strict_rule_engine": (
                max(0, _integer(strict_completed))
                if strict_completed is not None
                else None
            ),
            "canonical_session": (
                max(0, _integer(canonical_completed))
                if canonical_completed is not None
                else None
            ),
        },
        "aborted_repetitions": aborted_repetitions,
        "average_response_time_ms": (
            max(0, _integer(rule_summary.get("average_response_time_ms")))
            if rule_summary.get("average_response_time_ms") is not None
            else None
        ),
        "tracking_quality_percentage": (
            max(
                0,
                min(
                    100,
                    round(_number(tracking_quality_percentage), 1),
                ),
            )
            if tracking_quality_percentage is not None
            else None
        ),
        "common_form_errors": errors,
        "per_step_duration_ms": step_durations,
        "corrections_applied": max(
            0, _integer(rule_summary.get("corrections_applied"))
        ),
        "capture_duration_ms": max(
            0, _integer(metadata.get("captureDurationMs"))
        ),
        "forecast_summary": _acp_forecast_summary(metadata),
    }


def upsert_practice_analytics(db, session_id, metadata):
    from models.training_memory import PracticeSessionAnalytics

    payload = extract_practice_analytics(metadata)
    record = db.query(PracticeSessionAnalytics).filter(
        PracticeSessionAnalytics.practice_session_id == session_id
    ).first()
    if not record:
        record = PracticeSessionAnalytics(
            practice_session_id=session_id,
            payload="{}",
        )
        db.add(record)
    record.schema_version = ANALYTICS_SCHEMA_VERSION
    record.payload = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    return payload


def _decode_payload(record):
    try:
        payload = json.loads(record.payload)
        return payload if isinstance(payload, dict) else {}
    except (TypeError, json.JSONDecodeError):
        return {}


def canonical_practice_rep_count(session, analytics=None):
    """Return the v2 detected-attempt count, falling back for legacy sessions."""
    analytics = analytics if isinstance(analytics, dict) else {}
    if analytics.get("detected_attempts") is not None:
        return max(0, _integer(analytics.get("detected_attempts")))
    return max(0, _integer(getattr(session, "completed_reps", 0)))


def canonical_practice_accuracy(session, analytics=None):
    """Return v2 biomechanical quality as a percentage when it is available."""
    analytics = analytics if isinstance(analytics, dict) else {}
    if analytics.get("technique_quality") is not None:
        return max(0, min(100, _number(analytics.get("technique_quality")) * 100))
    return max(0, min(100, _number(getattr(session, "average_accuracy", 0))))


def load_practice_analytics(db, session_ids):
    from models.training_memory import (
        PracticeSession,
        PracticeSessionAnalytics,
        PracticeSessionTape,
    )

    ids = [int(value) for value in session_ids if value is not None]
    if not ids:
        return {}

    records = db.query(PracticeSessionAnalytics).filter(
        PracticeSessionAnalytics.practice_session_id.in_(ids)
    ).all()
    result = {
        record.practice_session_id: _decode_payload(record)
        for record in records
        if record.schema_version >= ANALYTICS_SCHEMA_VERSION
    }

    missing_ids = [session_id for session_id in ids if session_id not in result]
    if not missing_ids:
        return result

    tapes = db.query(PracticeSessionTape).filter(
        PracticeSessionTape.practice_session_id.in_(missing_ids)
    ).order_by(PracticeSessionTape.updated_at.desc()).limit(50).all()
    canonical_sessions = {
        session.id: session
        for session in db.query(PracticeSession).filter(
            PracticeSession.id.in_([tape.practice_session_id for tape in tapes])
        ).all()
    }
    backfilled = False
    for tape in tapes:
        try:
            document = json.loads(zlib.decompress(tape.payload).decode("utf-8"))
            canonical_session = canonical_sessions.get(tape.practice_session_id)
            metadata = {
                **(document.get("metadata") or {}),
                "captureDurationMs": document.get("duration_ms") or 0,
                "canonicalCompletedReps": (
                    canonical_session.completed_reps
                    if canonical_session is not None
                    else None
                ),
                "canonicalTargetReps": (
                    canonical_session.target_reps
                    if canonical_session is not None
                    else None
                ),
            }
            result[tape.practice_session_id] = upsert_practice_analytics(
                db,
                tape.practice_session_id,
                metadata,
            )
            backfilled = True
        except (zlib.error, UnicodeDecodeError, json.JSONDecodeError, AttributeError):
            result[tape.practice_session_id] = {}
    if backfilled:
        db.commit()
    return result
