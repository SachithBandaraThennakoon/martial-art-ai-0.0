import base64
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from auth_context import get_current_user
from database import Base, get_db
from models.refresh_session import RefreshSession
from models.user import User
from routers.auth import router as auth_router
from services.refresh_sessions import issue_refresh_session
from utils.security import hash_password, verify_password


class ProfileControlsTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.user = User(
            name="Training Student",
            email="profile@example.com",
            password_hash=hash_password("current-password"),
            role="user",
            plan="FREE_PLAN",
        )
        self.db.add(self.user)
        self.db.commit()

        self.app = FastAPI()
        self.app.include_router(auth_router)
        self.app.dependency_overrides[get_db] = lambda: self.db
        self.app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(self.app)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_profile_update_normalizes_and_returns_training_preferences(self):
        response = self.client.patch("/me", json={
            "name": "  Training   Student  ",
            "primary_martial_art": " Muay   Thai ",
            "experience_level": "intermediate",
            "preferred_stance": "switch",
            "training_goals": ["technique", "fitness", "technique"],
            "measurement_units": "metric",
            "coaching_style": "direct",
        })

        self.assertEqual(response.status_code, 200)
        profile = response.json()
        self.assertEqual(profile["name"], "Training Student")
        self.assertEqual(profile["primary_martial_art"], "Muay Thai")
        self.assertEqual(profile["training_goals"], ["technique", "fitness"])
        self.assertEqual(profile["coaching_style"], "direct")
        self.assertEqual(profile["email"], "profile@example.com")

    def test_profile_rejects_unknown_controlled_values(self):
        response = self.client.patch("/me", json={
            "name": "Training Student",
            "experience_level": "grandmaster",
            "preferred_stance": "",
            "training_goals": [],
            "measurement_units": "metric",
            "coaching_style": "balanced",
        })

        self.assertEqual(response.status_code, 422)
        self.db.refresh(self.user)
        self.assertIsNone(self.user.experience_level)

    def test_password_change_verifies_current_password_and_revokes_sessions(self):
        _raw_token, session = issue_refresh_session(self.db, self.user)
        self.db.commit()

        rejected = self.client.put("/account/password", json={
            "current_password": "wrong-password",
            "new_password": "new-safe-password",
        })
        self.assertEqual(rejected.status_code, 401)

        response = self.client.put("/account/password", json={
            "current_password": "current-password",
            "new_password": "new-safe-password",
        })
        self.assertEqual(response.status_code, 200)
        self.db.refresh(self.user)
        self.db.refresh(session)
        self.assertTrue(verify_password("new-safe-password", self.user.password_hash))
        self.assertIsNotNone(session.revoked_at)
        self.assertEqual(self.db.query(RefreshSession).count(), 1)

    def test_avatar_upload_is_private_validated_and_removable(self):
        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        )
        response = self.client.put(
            "/me/avatar",
            files={"avatar": ("avatar.png", png, "image/png")},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["has_avatar"])
        self.assertIsNotNone(response.json()["avatar_updated_at"])

        image = self.client.get("/me/avatar")
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image.headers["content-type"], "image/png")
        self.assertEqual(image.content, png)
        self.assertEqual(image.headers["x-content-type-options"], "nosniff")

        removed = self.client.delete("/me/avatar")
        self.assertEqual(removed.status_code, 200)
        self.assertFalse(removed.json()["has_avatar"])
        self.assertEqual(self.client.get("/me/avatar").status_code, 404)

    def test_avatar_upload_rejects_mismatched_file_contents(self):
        response = self.client.put(
            "/me/avatar",
            files={"avatar": ("not-really.png", b"not an image", "image/png")},
        )
        self.assertEqual(response.status_code, 415)
        self.db.refresh(self.user)
        self.assertIsNone(self.user.avatar_data)


if __name__ == "__main__":
    unittest.main()
