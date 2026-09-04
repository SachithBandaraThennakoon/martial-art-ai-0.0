import hashlib
import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
from database import Base, get_db
from models.technique import Technique
from models.training_memory import (
    PracticeRep,
    PracticeSession,
    PracticeSessionTape,
    PracticeSessionVideo,
)
from models.user import User
from tests.test_tape_storage import valid_document
from utils.security import create_access_token


class TapeAPITests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, expire_on_commit=False)()
        self.user = User(
            email="tape@example.com",
            password_hash="unused",
            role="user",
            plan="FREE_PLAN",
            subscription_status="inactive",
        )
        technique = Technique(name="Jab", category="Boxing", required_plan="FREE_PLAN")
        self.db.add_all([self.user, technique])
        self.db.commit()
        self.session = PracticeSession(
            user_id=self.user.id,
            technique_id=technique.id,
            technique_name="Jab",
            target_reps=3,
            status="completed",
        )
        self.db.add(self.session)
        self.db.commit()
        self.token = create_access_token({"sub": str(self.user.id), "uid": self.user.id})
        main.app.dependency_overrides[get_db] = lambda: self.db
        self.limit_patch = patch("main.enforce_rate_limits")
        self.limit_patch.start()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.limit_patch.stop()
        main.app.dependency_overrides.clear()
        self.db.close()
        self.engine.dispose()

    def headers(self, **extra):
        return {"Authorization": f"Bearer {self.token}", **extra}

    def test_inline_intent_store_read_and_idempotent_retry(self):
        before_store = self.client.get(
            "/practice/analysis?technique_name=Jab",
            headers=self.headers(),
        )
        self.assertEqual(before_store.status_code, 200)
        self.assertFalse(before_store.json()["sessions"][0]["tape_available"])
        dashboard_before_store = self.client.get("/dashboard", headers=self.headers())
        self.assertEqual(dashboard_before_store.status_code, 200)
        self.assertFalse(dashboard_before_store.json()["sessions"][0]["tape_available"])

        document = valid_document()
        document["metadata"]["sessionId"] = self.session.id
        document["metadata"]["analysisAuthority"] = "recorded-video"
        document["metadata"]["videoReplay"] = {
            "authoritative": True,
            "frameCount": 42,
            "retained": True,
        }
        document["metadata"]["videoReplayDiagnostics"] = {
            "status": "verified",
            "reason": None,
            "frameCount": 42,
            "effectiveFps": 15,
            "durationMs": 2800,
        }
        raw = json.dumps(document, separators=(",", ":"))
        digest = hashlib.sha256(raw.encode()).hexdigest()
        key = "tapeuploadidempotency000000000001"
        intent = self.client.post(
            f"/practice/sessions/{self.session.id}/tape/upload-intent",
            headers=self.headers(),
            json={
                "version": 2,
                "frame_rate": 30,
                "frame_count": 2,
                "duration_ms": 34,
                "content_length": len(raw.encode()),
                "content_sha256": digest,
                "idempotency_key": key,
                "algorithm_version": "biomechanics-v2",
                "config_version": "jab-2026-08",
            },
        )
        self.assertEqual(intent.status_code, 200)
        self.assertEqual(intent.json()["storage_mode"], "database")

        stored = self.client.put(
            f"/practice/sessions/{self.session.id}/tape",
            headers=self.headers(**{"Content-Type": "application/json", "Idempotency-Key": key}),
            content=raw,
        )
        self.assertEqual(stored.status_code, 200)
        tape = self.db.query(PracticeSessionTape).one()
        self.assertEqual(tape.content_sha256, digest)
        self.assertEqual(tape.capture_source, "device_estimate")

        retried = self.client.put(
            f"/practice/sessions/{self.session.id}/tape",
            headers=self.headers(**{"Content-Type": "application/json", "Idempotency-Key": key}),
            content=raw,
        )
        self.assertEqual(retried.status_code, 200)
        self.assertTrue(retried.json()["idempotent"])

        loaded = self.client.get(
            f"/practice/sessions/{self.session.id}/tape",
            headers=self.headers(),
        )
        self.assertEqual(loaded.status_code, 200)
        self.assertEqual(len(loaded.json()["frames"]), 2)
        self.assertEqual(loaded.json()["storage"]["capture_source"], "device_estimate")

        after_store = self.client.get(
            "/practice/analysis?technique_name=Jab",
            headers=self.headers(),
        )
        self.assertEqual(after_store.status_code, 200)
        self.assertTrue(after_store.json()["sessions"][0]["tape_available"])
        dashboard_after_store = self.client.get("/dashboard", headers=self.headers())
        self.assertEqual(dashboard_after_store.status_code, 200)
        self.assertTrue(dashboard_after_store.json()["sessions"][0]["tape_available"])

    def test_invalid_tape_is_rejected_before_persistence(self):
        document = valid_document()
        document["frames"][0]["unexpected"] = [1] * 100
        raw = json.dumps(document)
        response = self.client.put(
            f"/practice/sessions/{self.session.id}/tape",
            headers=self.headers(
                **{
                    "Content-Type": "application/json",
                    "Idempotency-Key": "tapeuploadidempotency000000000002",
                }
            ),
            content=raw,
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.db.query(PracticeSessionTape).count(), 0)

    def test_reposting_a_rep_updates_instead_of_duplicating_it(self):
        path = f"/practice/sessions/{self.session.id}/reps"
        first = self.client.post(
            path,
            headers=self.headers(),
            json={"rep_number": 1, "accuracy": 41, "duration_ms": 2200},
        )
        corrected = self.client.post(
            path,
            headers=self.headers(),
            json={"rep_number": 1, "accuracy": 93, "duration_ms": 1400},
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(corrected.status_code, 200)
        reps = self.db.query(PracticeRep).all()
        self.assertEqual(len(reps), 1)
        self.assertEqual(reps[0].accuracy, 93)
        self.assertEqual(reps[0].duration_ms, 1400)

    def test_sparse_corrected_summary_cannot_lower_persisted_rep_count(self):
        path = f"/practice/sessions/{self.session.id}/reps"
        for rep_number, accuracy in ((1, 90), (2, 70), (3, 50)):
            response = self.client.post(
                path,
                headers=self.headers(),
                json={
                    "rep_number": rep_number,
                    "accuracy": accuracy,
                    "duration_ms": 1500,
                },
            )
            self.assertEqual(response.status_code, 200)

        completed = self.client.patch(
            f"/practice/sessions/{self.session.id}/complete",
            headers=self.headers(),
            json={
                "status": "cancelled",
                "corrected_summary": {
                    "completed_reps": 1,
                    "clean_reps": 1,
                    "average_accuracy": 98,
                    "best_accuracy": 98,
                    "average_rep_seconds": 2.4,
                    "consistency_score": 100,
                },
            },
        )

        self.assertEqual(completed.status_code, 200)
        payload = completed.json()
        self.assertEqual(payload["completed_reps"], 3)
        self.assertEqual(payload["status"], "completed")
        self.assertEqual(payload["average_accuracy"], 70)
        self.assertEqual(payload["best_accuracy"], 90)

    def test_raw_video_store_metadata_read_and_idempotent_retry(self):
        raw_video = b"\x1aE\xdf\xa3mock-webm-video-payload"
        key = "videouploadidempotency00000000001"
        path = f"/practice/sessions/{self.session.id}/video"
        headers = self.headers(
            **{
                "Content-Type": "video/webm;codecs=vp9",
                "Idempotency-Key": key,
                "X-Video-Duration-Ms": "12450",
                "X-Video-Codec": "video/webm;codecs=vp9",
            }
        )

        stored = self.client.put(path, headers=headers, content=raw_video)
        self.assertEqual(stored.status_code, 200)
        metadata = stored.json()
        self.assertEqual(metadata["byte_size"], len(raw_video))
        self.assertEqual(metadata["duration_ms"], 12450)
        self.assertEqual(metadata["content_sha256"], hashlib.sha256(raw_video).hexdigest())

        video = self.db.query(PracticeSessionVideo).one()
        self.assertEqual(video.payload, raw_video)
        self.assertEqual(video.mime_type, "video/webm;codecs=vp9")

        retried = self.client.put(path, headers=headers, content=raw_video)
        self.assertEqual(retried.status_code, 200)
        self.assertTrue(retried.json()["idempotent"])
        self.assertEqual(self.db.query(PracticeSessionVideo).count(), 1)

        loaded_metadata = self.client.get(f"{path}/metadata", headers=self.headers())
        self.assertEqual(loaded_metadata.status_code, 200)
        self.assertEqual(loaded_metadata.json()["byte_size"], len(raw_video))

        loaded_video = self.client.get(path, headers=self.headers())
        self.assertEqual(loaded_video.status_code, 200)
        self.assertEqual(loaded_video.content, raw_video)
        self.assertEqual(loaded_video.headers["x-content-sha256"], metadata["content_sha256"])

    def test_raw_video_rejects_unsupported_content_type(self):
        response = self.client.put(
            f"/practice/sessions/{self.session.id}/video",
            headers=self.headers(
                **{
                    "Content-Type": "text/plain",
                    "Idempotency-Key": "videouploadidempotency00000000002",
                }
            ),
            content=b"not-video",
        )
        self.assertEqual(response.status_code, 415)
        self.assertEqual(self.db.query(PracticeSessionVideo).count(), 0)


if __name__ == "__main__":
    unittest.main()
