import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from models.body_calibration import BodyCalibration
from models.training_memory import PracticeRep, PracticeSession, TrainingSession
from models.user import User
from routers.auth import GUEST_COOKIE_NAME, REFRESH_COOKIE_NAME, router as auth_router


class GuestSessionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, expire_on_commit=False)()
        app = FastAPI()
        app.include_router(auth_router)
        app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.db.close()
        self.engine.dispose()

    def test_guest_session_is_real_isolated_account_with_sample_history(self):
        response = self.client.post("/guest-session")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["access_token"])
        self.assertTrue(payload["is_guest"])
        self.assertEqual(payload["name"], "X")
        self.assertEqual(payload["role"], "user")
        self.assertEqual(payload["plan"], "ELITE_PLAN")
        self.assertTrue(self.client.cookies.get(REFRESH_COOKIE_NAME))
        self.assertTrue(self.client.cookies.get(GUEST_COOKIE_NAME))
        self.assertIn("httponly", response.headers["set-cookie"].lower())

        user = self.db.query(User).filter(User.email == payload["email"]).one()
        self.assertEqual(
            self.db.query(PracticeSession).filter(PracticeSession.user_id == user.id).count(),
            3,
        )
        self.assertEqual(self.db.query(PracticeRep).count(), 12)
        self.assertEqual(
            self.db.query(TrainingSession).filter(TrainingSession.user_id == user.id).count(),
            1,
        )
        self.assertEqual(
            self.db.query(BodyCalibration).filter(BodyCalibration.user_id == user.id).count(),
            1,
        )

        me = self.client.get(
            "/me",
            headers={"Authorization": f"Bearer {payload['access_token']}"},
        )
        self.assertEqual(me.status_code, 200)
        self.assertTrue(me.json()["is_guest"])

    def test_browser_reuses_guest_identity_without_duplicate_seed_data(self):
        first = self.client.post("/guest-session").json()
        guest_cookie = self.client.cookies.get(GUEST_COOKIE_NAME)
        self.assertEqual(self.client.post("/logout").status_code, 200)
        self.assertEqual(self.client.cookies.get(GUEST_COOKIE_NAME), guest_cookie)

        second = self.client.post("/guest-session").json()

        self.assertEqual(second["id"], first["id"])
        self.assertEqual(second["email"], first["email"])
        self.assertEqual(self.db.query(User).count(), 1)
        self.assertEqual(self.db.query(PracticeSession).count(), 3)
        self.assertEqual(self.db.query(BodyCalibration).count(), 1)


if __name__ == "__main__":
    unittest.main()
