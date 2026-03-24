"""Add posture_rules and audit_logs tables

Revision ID: 003
Revises: 002
Create Date: 2026-03-07 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('posture_rules',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('rule_type', sa.String(length=50), nullable=False),
        sa.Column('value', sa.String(length=255), nullable=False),
        sa.Column('action', sa.String(length=20), nullable=True, server_default='block'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('description', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_posture_rules_rule_type'), 'posture_rules', ['rule_type'], unique=False)

    op.create_table('audit_logs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('stream_id', sa.String(length=64), nullable=True),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('action', sa.String(length=100), nullable=False),
        sa.Column('user_email', sa.String(length=255), nullable=True),
        sa.Column('user_id', sa.String(length=255), nullable=True),
        sa.Column('method', sa.String(length=10), nullable=True),
        sa.Column('path', sa.String(length=512), nullable=True),
        sa.Column('status_code', sa.Integer(), nullable=True),
        sa.Column('client_ip', sa.String(length=45), nullable=True),
        sa.Column('correlation_id', sa.String(length=64), nullable=True),
        sa.Column('detail', sa.String(length=2048), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_audit_logs_stream_id'), 'audit_logs', ['stream_id'], unique=True)
    op.create_index(op.f('ix_audit_logs_timestamp'), 'audit_logs', ['timestamp'], unique=False)
    op.create_index(op.f('ix_audit_logs_action'), 'audit_logs', ['action'], unique=False)
    op.create_index(op.f('ix_audit_logs_user_email'), 'audit_logs', ['user_email'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_audit_logs_user_email'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_action'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_timestamp'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_stream_id'), table_name='audit_logs')
    op.drop_table('audit_logs')
    op.drop_index(op.f('ix_posture_rules_rule_type'), table_name='posture_rules')
    op.drop_table('posture_rules')
