"""Store one raw practice video per session in the database.

Revision ID: f6c8a5d3e742
Revises: e5b7f4a2c631
Create Date: 2026-08-30
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f6c8a5d3e742"
down_revision: Union[str, Sequence[str], None] = "e5b7f4a2c631"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "practice_session_videos",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("practice_session_id", sa.Integer(), nullable=False),
        sa.Column("mime_type", sa.String(96), nullable=False),
        sa.Column("codec", sa.String(96), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("byte_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("idempotency_key", sa.String(64), nullable=False),
        sa.Column("payload", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["practice_session_id"],
            ["practice_sessions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "practice_session_id",
            name="uq_practice_session_videos_session",
        ),
    )
    op.create_index("ix_practice_session_videos_id", "practice_session_videos", ["id"])
    op.create_index(
        "ix_practice_session_videos_practice_session_id",
        "practice_session_videos",
        ["practice_session_id"],
        unique=True,
    )
    op.create_index(
        "ix_practice_session_videos_content_sha256",
        "practice_session_videos",
        ["content_sha256"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_practice_session_videos_content_sha256",
        table_name="practice_session_videos",
    )
    op.drop_index(
        "ix_practice_session_videos_practice_session_id",
        table_name="practice_session_videos",
    )
    op.drop_index("ix_practice_session_videos_id", table_name="practice_session_videos")
    op.drop_table("practice_session_videos")
