"""Preserve compatibility with legacy awareness and catalog databases.

Revision ID: fbf5a7c9d034
Revises: f1a2b3c4d5e6
Create Date: 2026-08-31

This revision was used by a development database that contains experimental
awareness and catalog tables outside the current application metadata. The
tables are retained as legacy data. Restoring the revision as a no-op keeps
that database on the supported migration line without modifying those tables.
"""
from typing import Sequence, Union


revision: str = "fbf5a7c9d034"
down_revision: Union[str, Sequence[str], None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
