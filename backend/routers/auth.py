from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import secrets

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from database import get_db
from auth_context import account_payload, get_current_user
from models.password_reset_token import PasswordResetToken
from models.privacy import ConsentRecord
from models.user import User
from services.password_reset_email import email_delivery_configured, send_password_reset_email
from services.refresh_sessions import (
    REFRESH_TOKEN_DAYS,
    issue_refresh_session,
    prune_expired_refresh_sessions,
    revoke_refresh_token,
    revoke_user_sessions,
    rotate_refresh_session,
)
from services.rate_limits import (
    FORGOT_PASSWORD_ACCOUNT,
    FORGOT_PASSWORD_IP,
    LOGIN_ACCOUNT,
    LOGIN_IP,
    GUEST_SESSION_IP,
    REFRESH_IP,
    REFRESH_TOKEN,
    REGISTER_ACCOUNT,
    REGISTER_IP,
    RESET_PASSWORD_IP,
    RESET_PASSWORD_TOKEN,
    client_ip,
    enforce_rate_limits,
)
from services.privacy import AGE_POLICY_VERSION, PRIVACY_NOTICE_VERSION, TERMS_VERSION
from utils.security import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
    hash_password,
    verify_password,
)
from services.guest_demo import get_or_create_guest

router = APIRouter()

APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").strip().rstrip("/")
RESET_TOKEN_MINUTES = 30
RESET_RESPONSE = "If an account matches that email, a password reset link is on its way."
REFRESH_COOKIE_NAME = "martial_refresh"
GUEST_COOKIE_NAME = "martial_guest"
COOKIE_SECURE = APP_ENV == "production"
COOKIE_SAMESITE = "none" if COOKIE_SECURE else "lax"
ALLOWED_BROWSER_ORIGINS = {
    origin.strip().rstrip("/")
    for origin in os.getenv("CORS_ORIGINS", FRONTEND_URL).split(",")
    if origin.strip()
}
ALLOWED_BROWSER_ORIGINS.add(FRONTEND_URL)

class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


ALLOWED_EXPERIENCE_LEVELS = {"beginner", "intermediate", "advanced", "instructor"}
ALLOWED_STANCES = {"orthodox", "southpaw", "switch", "not_sure"}
ALLOWED_GOALS = {"technique", "fitness", "flexibility", "self_defense", "competition", "mindfulness"}
ALLOWED_MEASUREMENT_UNITS = {"metric", "imperial"}
ALLOWED_COACHING_STYLES = {"supportive", "balanced", "direct"}
AVATAR_MAX_BYTES = 2 * 1024 * 1024
AVATAR_MEDIA_TYPES = {"image/jpeg", "image/png", "image/webp"}


class ProfileUpdateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    primary_martial_art: str = Field(default="", max_length=64)
    experience_level: str = ""
    preferred_stance: str = ""
    training_goals: list[str] = Field(default_factory=list, max_length=6)
    measurement_units: str = "metric"
    coaching_style: str = "balanced"

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        clean = " ".join(value.strip().split())
        if len(clean) < 2:
            raise ValueError("Please enter your full name")
        return clean

    @field_validator("primary_martial_art")
    @classmethod
    def normalize_martial_art(cls, value: str) -> str:
        return " ".join(value.strip().split())

    @field_validator("experience_level")
    @classmethod
    def validate_experience_level(cls, value: str) -> str:
        clean = value.strip().lower()
        if clean and clean not in ALLOWED_EXPERIENCE_LEVELS:
            raise ValueError("Choose a valid experience level")
        return clean

    @field_validator("preferred_stance")
    @classmethod
    def validate_stance(cls, value: str) -> str:
        clean = value.strip().lower()
        if clean and clean not in ALLOWED_STANCES:
            raise ValueError("Choose a valid stance")
        return clean

    @field_validator("training_goals")
    @classmethod
    def validate_training_goals(cls, value: list[str]) -> list[str]:
        clean = list(dict.fromkeys(item.strip().lower() for item in value))
        if any(item not in ALLOWED_GOALS for item in clean):
            raise ValueError("Choose valid training goals")
        return clean

    @field_validator("measurement_units")
    @classmethod
    def validate_units(cls, value: str) -> str:
        clean = value.strip().lower()
        if clean not in ALLOWED_MEASUREMENT_UNITS:
            raise ValueError("Choose valid measurement units")
        return clean

    @field_validator("coaching_style")
    @classmethod
    def validate_coaching_style(cls, value: str) -> str:
        clean = value.strip().lower()
        if clean not in ALLOWED_COACHING_STYLES:
            raise ValueError("Choose a valid coaching style")
        return clean


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


def _valid_email(value: str) -> bool:
    return "@" in value and "." in value.rsplit("@", 1)[-1]


def _detected_avatar_media_type(payload: bytes) -> str | None:
    if payload.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if payload.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(payload) >= 12 and payload[:4] == b"RIFF" and payload[8:12] == b"WEBP":
        return "image/webp"
    return None


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _require_trusted_browser_origin(request: Request) -> None:
    origin = (request.headers.get("origin") or "").strip().rstrip("/")
    if origin and origin not in ALLOWED_BROWSER_ORIGINS:
        raise HTTPException(status_code=403, detail="Browser origin is not allowed")


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        max_age=REFRESH_TOKEN_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )


def _session_payload(user: User) -> dict:
    return {
        "access_token": create_access_token({
            "sub": str(user.id),
            "uid": user.id,
            "email": user.email,
        }),
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        **account_payload(user),
    }


@router.post("/guest-session")
def guest_session(request: Request, response: Response, db: Session = Depends(get_db)):
    """Issue a real, isolated demo account with representative training history."""
    _require_trusted_browser_origin(request)
    enforce_rate_limits(db, (GUEST_SESSION_IP, client_ip(request)))
    user, browser_id = get_or_create_guest(db, request.cookies.get(GUEST_COOKIE_NAME))
    refresh_token, _session = issue_refresh_session(
        db,
        user,
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    _set_refresh_cookie(response, refresh_token)
    response.set_cookie(
        key=GUEST_COOKIE_NAME,
        value=browser_id,
        max_age=30 * 24 * 60 * 60,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )
    return _session_payload(user)


@router.post("/register")
def register(
    request: Request,
    name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    privacy_version: str = Form(...),
    terms_version: str = Form(...),
    accept_privacy: bool = Form(...),
    accept_terms: bool = Form(...),
    confirm_minimum_age: bool = Form(...),
    db: Session = Depends(get_db)
):
    clean_name = " ".join(name.strip().split())
    clean_email = email.strip().lower()
    _require_trusted_browser_origin(request)
    enforce_rate_limits(
        db,
        (REGISTER_IP, client_ip(request)),
        (REGISTER_ACCOUNT, clean_email),
    )

    if len(clean_name) < 2:
        raise HTTPException(status_code=400, detail="Please enter your full name")
    if "@" not in clean_email or "." not in clean_email.rsplit("@", 1)[-1]:
        raise HTTPException(status_code=400, detail="Please enter a valid email address")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not accept_privacy or privacy_version != PRIVACY_NOTICE_VERSION:
        raise HTTPException(status_code=409, detail="Please review and accept the current privacy notice")
    if not accept_terms or terms_version != TERMS_VERSION:
        raise HTTPException(status_code=409, detail="Please review and accept the current terms")
    if not confirm_minimum_age:
        raise HTTPException(status_code=400, detail="You must confirm that you are at least 18 years old")

    existing_user = db.query(User).filter(func.lower(User.email) == clean_email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        name=clean_name,
        email=clean_email,
        password_hash=hash_password(password),
        role="user",
        plan="FREE_PLAN",
        subscription_status="trial",
        trial_ends_at=_utcnow() + timedelta(days=3)
    )

    db.add(user)
    db.flush()
    db.add_all([
        ConsentRecord(user_id=user.id, document_type="privacy_notice", document_version=PRIVACY_NOTICE_VERSION, source="registration"),
        ConsentRecord(user_id=user.id, document_type="terms", document_version=TERMS_VERSION, source="registration"),
        ConsentRecord(user_id=user.id, document_type="age_policy", document_version=AGE_POLICY_VERSION, source="registration"),
    ])
    db.commit()

    return {"message": "User created successfully"}


@router.post("/login")
def login(
    response: Response,
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db)
):
    _require_trusted_browser_origin(request)
    clean_email = email.strip().lower()
    enforce_rate_limits(
        db,
        (LOGIN_IP, client_ip(request)),
        (LOGIN_ACCOUNT, clean_email),
    )
    user = db.query(User).filter(func.lower(User.email) == clean_email).first()

    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    prune_expired_refresh_sessions(db)
    refresh_token, _session = issue_refresh_session(
        db,
        user,
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    _set_refresh_cookie(response, refresh_token)
    return _session_payload(user)


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return account_payload(user)


@router.patch("/me")
def update_profile(
    payload: ProfileUpdateRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_trusted_browser_origin(request)
    if (user.email or "").lower().endswith("@guest.xmartialart.invalid"):
        raise HTTPException(status_code=403, detail="Create an account to save a personal profile")

    user.name = payload.name
    user.primary_martial_art = payload.primary_martial_art or None
    user.experience_level = payload.experience_level or None
    user.preferred_stance = payload.preferred_stance or None
    user.training_goals = json.dumps(payload.training_goals)
    user.measurement_units = payload.measurement_units
    user.coaching_style = payload.coaching_style
    db.commit()
    db.refresh(user)
    return account_payload(user)


@router.get("/me/avatar")
def get_avatar(user: User = Depends(get_current_user)):
    if not user.avatar_data or user.avatar_content_type not in AVATAR_MEDIA_TYPES:
        raise HTTPException(status_code=404, detail="Profile image not found")
    return Response(
        content=user.avatar_data,
        media_type=user.avatar_content_type,
        headers={
            "Cache-Control": "private, max-age=3600",
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.put("/me/avatar")
async def update_avatar(
    request: Request,
    avatar: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_trusted_browser_origin(request)
    if (user.email or "").lower().endswith("@guest.xmartialart.invalid"):
        raise HTTPException(status_code=403, detail="Create an account to save a profile image")
    if avatar.content_type not in AVATAR_MEDIA_TYPES:
        raise HTTPException(status_code=415, detail="Choose a JPEG, PNG, or WebP image")

    payload = await avatar.read(AVATAR_MAX_BYTES + 1)
    await avatar.close()
    if not payload:
        raise HTTPException(status_code=400, detail="The selected image is empty")
    if len(payload) > AVATAR_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Profile images must be 2 MB or smaller")

    detected_type = _detected_avatar_media_type(payload)
    if detected_type is None or detected_type != avatar.content_type:
        raise HTTPException(status_code=415, detail="The file contents do not match a supported image format")

    user.avatar_data = payload
    user.avatar_content_type = detected_type
    user.avatar_updated_at = _utcnow()
    db.commit()
    db.refresh(user)
    return account_payload(user)


@router.delete("/me/avatar")
def delete_avatar(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_trusted_browser_origin(request)
    user.avatar_data = None
    user.avatar_content_type = None
    user.avatar_updated_at = None
    db.commit()
    return account_payload(user)


@router.put("/account/password")
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_trusted_browser_origin(request)
    if (user.email or "").lower().endswith("@guest.xmartialart.invalid"):
        raise HTTPException(status_code=403, detail="Guest sessions do not have passwords")
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if verify_password(payload.new_password, user.password_hash):
        raise HTTPException(status_code=400, detail="New password must be different from the current password")

    user.password_hash = hash_password(payload.new_password)
    revoke_user_sessions(db, user.id, _utcnow())
    db.commit()
    return {"message": "Password updated. Sign in again with your new password."}


@router.post("/refresh")
def refresh_session(request: Request, response: Response, db: Session = Depends(get_db)):
    _require_trusted_browser_origin(request)
    raw_token = request.cookies.get(REFRESH_COOKIE_NAME)
    enforce_rate_limits(
        db,
        (REFRESH_IP, client_ip(request)),
        (REFRESH_TOKEN, raw_token or "missing"),
    )
    if not raw_token:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Refresh session is required")

    try:
        replacement_token, _replacement, user = rotate_refresh_session(
            db,
            raw_token,
            user_agent=request.headers.get("user-agent"),
        )
    except HTTPException:
        _clear_refresh_cookie(response)
        raise

    _set_refresh_cookie(response, replacement_token)
    return _session_payload(user)


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    _require_trusted_browser_origin(request)
    revoke_refresh_token(db, request.cookies.get(REFRESH_COOKIE_NAME))
    db.commit()
    _clear_refresh_cookie(response)
    return {"message": "Signed out"}


@router.post("/forgot-password")
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    clean_email = payload.email.strip().lower()
    _require_trusted_browser_origin(request)
    enforce_rate_limits(
        db,
        (FORGOT_PASSWORD_IP, client_ip(request)),
        (FORGOT_PASSWORD_ACCOUNT, clean_email),
    )
    response = {"message": RESET_RESPONSE}

    if clean_email.endswith("@guest.xmartialart.invalid"):
        return response

    # Invalid and unknown addresses receive the same response to avoid account enumeration.
    if not _valid_email(clean_email):
        return response

    user = db.query(User).filter(func.lower(User.email) == clean_email).first()
    if not user:
        return response

    now = _utcnow()
    db.query(PasswordResetToken).filter(
        or_(
            PasswordResetToken.expires_at < now,
            PasswordResetToken.used_at.isnot(None),
        )
    ).delete(synchronize_session=False)
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used_at.is_(None),
    ).update({PasswordResetToken.used_at: now}, synchronize_session=False)

    raw_token = secrets.token_urlsafe(32)
    reset_token = PasswordResetToken(
        user_id=user.id,
        token_hash=_token_hash(raw_token),
        expires_at=now + timedelta(minutes=RESET_TOKEN_MINUTES),
    )
    db.add(reset_token)
    db.commit()

    reset_url = f"{FRONTEND_URL}/reset-password?token={raw_token}"
    delivered = send_password_reset_email(clean_email, reset_url)

    # Local development remains testable without exposing reset tokens in production.
    if APP_ENV != "production" and not email_delivery_configured() and not delivered:
        response["development_reset_url"] = reset_url

    return response


@router.post("/reset-password")
def reset_password(
    payload: ResetPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    token = payload.token.strip()
    _require_trusted_browser_origin(request)
    enforce_rate_limits(
        db,
        (RESET_PASSWORD_IP, client_ip(request)),
        (RESET_PASSWORD_TOKEN, token or "missing"),
    )
    if not token:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired.")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    now = _utcnow()
    reset_token = db.query(PasswordResetToken).filter(
        PasswordResetToken.token_hash == _token_hash(token),
        PasswordResetToken.used_at.is_(None),
        PasswordResetToken.expires_at >= now,
    ).first()

    if not reset_token:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired.")

    user = db.query(User).filter(User.id == reset_token.user_id).first()
    if not user:
        reset_token.used_at = now
        db.commit()
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired.")

    user.password_hash = hash_password(payload.password)
    revoke_user_sessions(db, user.id, now)
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used_at.is_(None),
    ).update({PasswordResetToken.used_at: now}, synchronize_session=False)
    db.commit()

    return {"message": "Password updated. You can now sign in with your new password."}
