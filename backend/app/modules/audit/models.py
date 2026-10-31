"""
Audit Logs ORM Model [PDF 5.10, 9].
Captures immutable before/after snapshots for all money-affecting entities:
price changes, role changes, discount edits, payments, invoice state transitions.
"""
import uuid
from datetime import datetime
from sqlalchemy import Column, DateTime, JSON, String
from app.core.db import Base


class AuditLog(Base):
    """Immutable audit log entity [PDF 5.10, 9]."""
    __tablename__ = "audit_logs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    actor_id = Column(String(36), nullable=True, index=True)
    entity = Column(String(100), nullable=False, index=True)
    entity_id = Column(String(100), nullable=False, index=True)
    action = Column(String(50), nullable=False)
    before_json = Column(JSON, nullable=True)
    after_json = Column(JSON, nullable=True)
    ip = Column(String(45), nullable=True)
    at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False, index=True)

    def __repr__(self):
        return f"<AuditLog id={self.id} entity={self.entity} action={self.action} actor={self.actor_id}>"
