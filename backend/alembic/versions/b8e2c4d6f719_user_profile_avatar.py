"""Store private profile avatars on users.

Revision ID: b8e2c4d6f719
Revises: a7d9e1f3b564
Create Date: 2026-08-31
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b8e2c4d6f719"
down_revision: Union[str, Sequence[str], None] = "a7d9e1f3b564"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_data", sa.LargeBinary(), nullable=True))
    op.add_column("users", sa.Column("avatar_content_type", sa.String(32), nullable=True))
    op.add_column("users", sa.Column("avatar_updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_updated_at")
    op.drop_column("users", "avatar_content_type")
    op.drop_column("users", "avatar_data")
