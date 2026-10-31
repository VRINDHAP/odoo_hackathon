"""
Audit Logging Service [PDF 5.10, 9].
Persists before/after JSON diffs for money-affecting actions.
"""
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session
from app.modules.audit.models import AuditLog


class AuditService:
    """Service capturing and retrieving immutable audit records."""

    @staticmethod
    def record(
        db: Session,
        entity: str,
        entity_id: str,
        action: str,
        actor_id: Optional[str] = None,
        before_json: Optional[Dict[str, Any]] = None,
        after_json: Optional[Dict[str, Any]] = None,
        ip: Optional[str] = None,
    ) -> AuditLog:
        """
        Creates an immutable audit log entry [PDF 5.10, 9].
        """
        log_entry = AuditLog(
            actor_id=actor_id,
            entity=entity,
            entity_id=str(entity_id),
            action=action,
            before_json=before_json,
            after_json=after_json,
            ip=ip,
        )
        db.add(log_entry)
        db.commit()
        db.refresh(log_entry)
        return log_entry

    @staticmethod
    def list_logs(
        db: Session,
        skip: int = 0,
        limit: int = 20,
        entity: Optional[str] = None,
        actor_id: Optional[str] = None,
    ) -> List[AuditLog]:
        """Queries audit trail with filtering and pagination."""
        query = db.query(AuditLog)
        if entity:
            query = query.filter(AuditLog.entity == entity)
        if actor_id:
            query = query.filter(AuditLog.actor_id == actor_id)
        return query.order_by(AuditLog.at.desc()).offset(skip).limit(limit).all()
