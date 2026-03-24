"""Add RoutePolicy

Revision ID: 002
Revises: 001
Create Date: 2026-02-21 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('route_policies',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.String(length=255), nullable=True),
        sa.Column('pattern', sa.String(length=255), nullable=False),
        sa.Column('priority', sa.Integer(), nullable=False, server_default='100'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('allow_any_authenticated', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_route_policies_name'), 'route_policies', ['name'], unique=True)
    op.create_index(op.f('ix_route_policies_priority'), 'route_policies', ['priority'], unique=False)

    op.create_table('policy_roles',
        sa.Column('policy_id', sa.Integer(), nullable=False),
        sa.Column('role_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['policy_id'], ['route_policies.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('policy_id', 'role_id')
    )


def downgrade() -> None:
    op.drop_table('policy_roles')
    op.drop_index(op.f('ix_route_policies_priority'), table_name='route_policies')
    op.drop_index(op.f('ix_route_policies_name'), table_name='route_policies')
    op.drop_table('route_policies')
