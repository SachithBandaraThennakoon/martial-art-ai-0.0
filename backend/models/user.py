from sqlalchemy import Column, DateTime, Integer, LargeBinary, String, Text, func
from database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)
    role = Column(String, default="user")
    plan = Column(String, default="FREE_PLAN")
    subscription_status = Column(String, default="trial")
    paypal_subscription_id = Column(String, nullable=True, unique=True)
    trial_ends_at = Column(DateTime, nullable=True)
    subscription_ends_at = Column(DateTime, nullable=True)
    primary_martial_art = Column(String(64), nullable=True)
    experience_level = Column(String(24), nullable=True)
    preferred_stance = Column(String(24), nullable=True)
    training_goals = Column(Text, nullable=False, default="[]")
    measurement_units = Column(String(16), nullable=False, default="metric")
    coaching_style = Column(String(24), nullable=False, default="balanced")
    avatar_data = Column(LargeBinary, nullable=True)
    avatar_content_type = Column(String(32), nullable=True)
    avatar_updated_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
