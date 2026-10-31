"""
Users Domain Service: Staff Provisioning and Last-Admin Demotion Guard [PDF 2, 8, 9].
"""
from typing import List, Optional
from sqlalchemy.orm import Session
from app.core.errors import BadRequestError, ConflictError, NotFoundError
from app.core.security import hash_password
from app.modules.auth.models import User, UserRole
from app.modules.auth.schemas import UserResponse
from app.modules.users.repository import UserRepository
from app.modules.users.schemas import StaffCreateRequest, UserUpdateRequest


class UserService:
    """Service handling internal staff accounts and administrative user management."""

    @staticmethod
    def create_staff(db: Session, admin_user: User, request: StaffCreateRequest) -> UserResponse:
        """
        Provisions a new staff or admin account (Admin only) [PDF 2, 8].
        - Checks for duplicate email.
        - Hashes password with Argon2id.
        """
        existing = UserRepository.get_by_email(db, request.email)
        if existing:
            raise ConflictError("An account with this email address already exists.")

        hashed_pwd = hash_password(request.password)
        new_user = UserRepository.create_user(
            db=db,
            email=request.email,
            password_hash=hashed_pwd,
            role=request.role,
        )
        return UserResponse.model_validate(new_user)

    @staticmethod
    def update_user(
        db: Session,
        admin_user: User,
        target_user_id: str,
        request: UserUpdateRequest,
    ) -> UserResponse:
        """
        Updates an existing user's role or status [PDF 9].
        Critical Guard: The last remaining active administrator cannot be demoted or deactivated.
        """
        target_user = UserRepository.get_by_id(db, target_user_id)
        if not target_user:
            raise NotFoundError("User", target_user_id)

        # Last Admin Demotion Guard [PDF 9]
        if target_user.role == UserRole.ADMIN:
            demoting = request.role is not None and request.role != UserRole.ADMIN
            deactivating = request.is_active is False

            if demoting or deactivating:
                active_admins = UserRepository.count_active_admins(db)
                if active_admins <= 1:
                    raise BadRequestError(
                        "Operation blocked: Cannot demote or deactivate the last remaining active administrator."
                    )

        updated = UserRepository.update_user(
            db=db,
            user=target_user,
            role=request.role,
            is_active=request.is_active,
        )
        return UserResponse.model_validate(updated)

    @staticmethod
    def list_users(
        db: Session,
        skip: int = 0,
        limit: int = 20,
        role: Optional[UserRole] = None,
    ) -> List[UserResponse]:
        """Lists users with pagination and optional role filtering."""
        users = UserRepository.list_users(db=db, skip=skip, limit=limit, role=role)
        return [UserResponse.model_validate(u) for u in users]
