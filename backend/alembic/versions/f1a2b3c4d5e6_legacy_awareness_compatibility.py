"""Preserve compatibility with legacy awareness-enabled databases.

Revision ID: f1a2b3c4d5e6
Revises: e5b7f4a2c631
Create Date: 2026-08-31

Some development databases were stamped with this revision after adding
experimental awareness tables. Those tables are intentionally retained as
legacy data and are not owned by the current SQLAlchemy metadata. Restoring
the revision as a no-op keeps those databases on the supported migration
line without creating, altering, or deleting the legacy tables.
"""
from typing import Sequence, Union


revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "e5b7f4a2c631"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
