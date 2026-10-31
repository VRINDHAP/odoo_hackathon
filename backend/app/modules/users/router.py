"""
Users and Staff Provisioning Router (/api/v1/users) [PDF 2, 8, 9].
Provides Admin-only staff creation and last-admin demotion protection.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from app.core.deps import get_db, PaginationParams, require_admin, require_staff_or_admin
from app.modules.auth.models import User, UserRole
from app.modules.auth.schemas import UserResponse
from app.modules.users.schemas import StaffCreateRequest, UserUpdateRequest
from app.modules.users.service import UserService

router = APIRouter(prefix="/users", tags=["Users & Staff"])


@router.post(
    "/staff",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Provision internal staff or admin account (Admin only) [PDF 2, 8]",
)
def create_staff(
    request: StaffCreateRequest,
    current_admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Staff creation endpoint:
    - Restricted exclusively to authenticated administrators (HTTP 403 for staff/customer).
    - Can provision 'staff' or 'admin' roles.
    """
    return UserService.create_staff(db=db, admin_user=current_admin, request=request)


@router.get(
    "",
    response_model=List[UserResponse],
    status_code=status.HTTP_200_OK,
    summary="List system users with pagination (Admin/Staff only) [PDF 2, 8]",
)
def list_users(
    role: Optional[UserRole] = Query(None, description="Filter by role"),
    pagination: PaginationParams = Depends(),
    current_user: User = Depends(require_staff_or_admin),
    db: Session = Depends(get_db),
):
    """
    List users endpoint with server-side pagination and optional role filter.
    """
    return UserService.list_users(
        db=db,
        skip=pagination.skip,
        limit=pagination.limit,
        role=role,
    )


@router.patch(
    "/{user_id}",
    response_model=UserResponse,
    status_code=status.HTTP_200_OK,
    summary="Update user role or active status (Admin only) [PDF 2, 8, 9]",
)
def update_user(
    user_id: str,
    request: UserUpdateRequest,
    current_admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    User update endpoint:
    - Enforces last-admin demotion guard: rejecting demotion or deactivation if only 1 admin remains.
    """
    return UserService.update_user(
        db=db,
        admin_user=current_admin,
        target_user_id=user_id,
        request=request,
    )
