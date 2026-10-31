"""
Audit Log Pydantic Schemas [PDF 5.10, 8].
"""
from datetime import datetime
from typing import Any, Dict, Optional
from pydantic import BaseModel, ConfigDict


class AuditLogResponse(BaseModel):
    """Audit log entry response."""
    id: str
    actor_id: Optional[str] = None
    entity: str
    entity_id: str
    action: str
    before_json: Optional[Dict[str, Any]] = None
    after_json: Optional[Dict[str, Any]] = None
    ip: Optional[str] = None
    at: datetime

    model_config = ConfigDict(from_attributes=True)
