"""
FastAPI Dependency Injection Providers [PDF 2, 8, 11].
Includes Database Session provider, standard Pagination parameters,
and 3-Layer RBAC user authentication & role verification dependencies.
"""
from typing import Generator, List, Optional
from fastapi import Depends, Header, Query
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.errors import ForbiddenError, UnauthorizedError
from app.core.security import decode_access_token
from app.modules.auth.models import User, UserRole


class PaginationParams:
    """Standardized server-side pagination dependency [PDF 11]."""

    def __init__(
        self,
        page: int = Query(1, ge=1, description="Page number starting at 1"),
        page_size: int = Query(20, ge=1, le=100, description="Items per page (max 100)"),
    ):
        self.page = page
        self.page_size = page_size
        self.skip = (page - 1) * page_size
        self.limit = page_size


def get_current_user(
    authorization: Optional[str] = Header(None, description="Bearer <JWT>"),
    db: Session = Depends(get_db),
) -> User:
    """
    Decodes the Bearer JWT token from the Authorization header,
    verifies the signature and expiration, and fetches the active User entity [PDF 2, 9].
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise UnauthorizedError("Missing or malformed Authorization header. Expected 'Bearer <token>'.")

    token = authorization.split(" ", 1)[1].strip()
    payload = decode_access_token(token)
    user_id = payload.get("sub")

    if not user_id:
        raise UnauthorizedError("Invalid token: subject claim missing.")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise UnauthorizedError("User associated with this token does not exist.")

    if not user.is_active:
        raise ForbiddenError("User account is inactive. Access forbidden.")

    return user


def get_current_user_optional(
    authorization: Optional[str] = Header(None, description="Bearer <JWT>"),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """
    Optional authentication dependency [PDF 2].
    Returns the User entity if a valid Bearer token is provided, otherwise None.
    Does not raise UnauthorizedError when the Authorization header is omitted.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None

    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        if not user_id:
            return None

        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.is_active:
            return None

        return user
    except Exception:
        return None


def require_role(*allowed_roles: UserRole):
    """
    Dependency factory enforcing Role-Based Access Control (RBAC) [PDF 2].
    Throws HTTP 403 Forbidden if user's role is not within allowed_roles.
    """
    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            role_names = ", ".join(r.value for r in allowed_roles)
            raise ForbiddenError(
                f"Insufficient permissions. Required role: [{role_names}], your role: '{current_user.role.value}'."
            )
        return current_user

    return role_checker


# Convenient RBAC shortcuts
require_admin = require_role(UserRole.ADMIN)
require_staff_or_admin = require_role(UserRole.ADMIN, UserRole.STAFF)
