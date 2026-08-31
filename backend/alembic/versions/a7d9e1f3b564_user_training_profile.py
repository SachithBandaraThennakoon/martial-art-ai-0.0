"""Add private martial arts profile preferences to users.

Revision ID: a7d9e1f3b564
Revises: f6c8a5d3e742
Create Date: 2026-08-31
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a7d9e1f3b564"
down_revision: Union[str, Sequence[str], None] = "f6c8a5d3e742"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("primary_martial_art", sa.String(64), nullable=True))
    op.add_column("users", sa.Column("experience_level", sa.String(24), nullable=True))
    op.add_column("users", sa.Column("preferred_stance", sa.String(24), nullable=True))
    op.add_column("users", sa.Column("training_goals", sa.Text(), server_default="[]", nullable=False))
    op.add_column("users", sa.Column("measurement_units", sa.String(16), server_default="metric", nullable=False))
    op.add_column("users", sa.Column("coaching_style", sa.String(24), server_default="balanced", nullable=False))
    op.add_column("users", sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.add_column("users", sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))


def downgrade() -> None:
    op.drop_column("users", "updated_at")
    op.drop_column("users", "created_at")
    op.drop_column("users", "coaching_style")
    op.drop_column("users", "measurement_units")
    op.drop_column("users", "training_goals")
    op.drop_column("users", "preferred_stance")
    op.drop_column("users", "experience_level")
    op.drop_column("users", "primary_martial_art")
