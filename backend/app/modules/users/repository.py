"""
Database Repository for Users Management and Admin Demotion Protection [PDF 2, 5.1, 9].
"""
from typing import List, Optional
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.modules.auth.models import User, UserRole


class UserRepository:
    """Repository handling user directory queries and role mutations."""

    @staticmethod
    def get_by_id(db: Session, user_id: str) -> Optional[User]:
        return db.query(User).filter(User.id == user_id).first()

    @staticmethod
    def get_by_email(db: Session, email: str) -> Optional[User]:
        return db.query(User).filter(func.lower(User.email) == email.strip().lower()).first()

    @staticmethod
    def count_active_admins(db: Session) -> int:
        """Counts the total number of currently active administrators [PDF 9]."""
        return (
            db.query(func.count(User.id))
            .filter(User.role == UserRole.ADMIN, User.is_active == True)  # noqa: E712
            .scalar()
            or 0
        )

    @staticmethod
    def create_user(
        db: Session,
        email: str,
        password_hash: str,
        role: UserRole,
    ) -> User:
        user = User(
            email=email.strip().lower(),
            password_hash=password_hash,
            role=role,
            is_active=True,
            failed_attempts=0,
            locked_until=None,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    @staticmethod
    def list_users(
        db: Session,
        skip: int = 0,
        limit: int = 20,
        role: Optional[UserRole] = None,
    ) -> List[User]:
        query = db.query(User)
        if role:
            query = query.filter(User.role == role)
        return query.order_by(User.created_at.desc()).offset(skip).limit(limit).all()

    @staticmethod
    def update_user(
        db: Session,
        user: User,
        role: Optional[UserRole] = None,
        is_active: Optional[bool] = None,
    ) -> User:
        if role is not None:
            user.role = role
        if is_active is not None:
            user.is_active = is_active
        db.commit()
        db.refresh(user)
        return user
