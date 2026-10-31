"""
Audit Logs API Router (/api/v1/audit_logs) [PDF 2, 8, 12].
Accessible strictly to administrators.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from app.core.deps import get_db, PaginationParams, require_admin
from app.modules.auth.models import User
from app.modules.audit.schemas import AuditLogResponse
from app.modules.audit.service import AuditService

router = APIRouter(prefix="/audit_logs", tags=["Audit Log"])


@router.get(
    "",
    response_model=List[AuditLogResponse],
    status_code=status.HTTP_200_OK,
    summary="List immutable audit records (Admin only) [PDF 2, 8]",
)
def get_audit_logs(
    entity: Optional[str] = Query(None, description="Filter by entity name (e.g. products, users, invoices)"),
    actor_id: Optional[str] = Query(None, description="Filter by actor user ID"),
    pagination: PaginationParams = Depends(),
    current_admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Returns audit trail entries with pagination and optional entity/actor filters.
    Strictly restricted to Admin role.
    """
    logs = AuditService.list_logs(
        db=db,
        skip=pagination.skip,
        limit=pagination.limit,
        entity=entity,
        actor_id=actor_id,
    )
    return [AuditLogResponse.model_validate(log) for log in logs]
