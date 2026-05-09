"""Add route_policies, posture_rules, audit_logs tables

Revision ID: 002
Revises: 001
Create Date: 2026-05-09

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "002"
down_revision: str | None = "001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "route_policies",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.String(255), nullable=True),
        sa.Column("pattern", sa.String(255), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("allow_any_authenticated", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_route_policies_name", "route_policies", ["name"], unique=True)
    op.create_index("ix_route_policies_priority", "route_policies", ["priority"])

    op.create_table(
        "policy_roles",
        sa.Column(
            "policy_id",
            sa.Integer(),
            sa.ForeignKey("route_policies.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "role_id",
            sa.Integer(),
            sa.ForeignKey("roles.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    op.create_table(
        "posture_rules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("rule_type", sa.String(50), nullable=False),
        sa.Column("value", sa.String(255), nullable=False),
        sa.Column("action", sa.String(20), nullable=False, server_default="block"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("description", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_posture_rules_rule_type", "posture_rules", ["rule_type"])

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("stream_id", sa.String(64), nullable=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=True),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("user_email", sa.String(255), nullable=True),
        sa.Column("user_id", sa.String(255), nullable=True),
        sa.Column("method", sa.String(10), nullable=True),
        sa.Column("path", sa.String(512), nullable=True),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("client_ip", sa.String(45), nullable=True),
        sa.Column("correlation_id", sa.String(64), nullable=True),
        sa.Column("detail", sa.String(2048), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_logs_stream_id", "audit_logs", ["stream_id"], unique=True)
    op.create_index("ix_audit_logs_timestamp", "audit_logs", ["timestamp"])
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])
    op.create_index("ix_audit_logs_user_email", "audit_logs", ["user_email"])


def downgrade() -> None:
    op.drop_table("audit_logs")
    op.drop_table("posture_rules")
    op.drop_table("policy_roles")
    op.drop_table("route_policies")
