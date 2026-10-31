"""
Database Repository for User and Identity Persistence [PDF 5.1, 9].
Encapsulates all SQLAlchemy queries for the auth domain.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.modules.auth.models import User, UserRole, RefreshToken, PasswordResetToken


class AuthRepository:
    """Repository managing User accounts, lockout status, and refresh tokens."""

    @staticmethod
    def get_by_email(db: Session, email: str) -> Optional[User]:
        """Case-insensitive user lookup by email [PDF 5.1, 9]."""
        return db.query(User).filter(func.lower(User.email) == email.strip().lower()).first()

    @staticmethod
    def get_by_id(db: Session, user_id: str) -> Optional[User]:
        """Find user by UUID primary key."""
        return db.query(User).filter(User.id == user_id).first()

    @staticmethod
    def create_customer_user(
        db: Session,
        email: str,
        password_hash: str,
        customer_id: Optional[str] = None,
    ) -> User:
        """Creates a new customer user (public signups are strictly role customer) [PDF 9]."""
        user = User(
            email=email.strip().lower(),
            password_hash=password_hash,
            role=UserRole.CUSTOMER,
            customer_id=customer_id,
            is_active=True,
            failed_attempts=0,
            locked_until=None,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    @staticmethod
    def increment_failed_attempts(
        db: Session, user: User, max_attempts: int = 5, lockout_minutes: int = 15
    ) -> User:
        """
        Increments failed login counter.
        Locks account for 15 minutes after 5 consecutive failures [PDF 5.1, 9].
        """
        user.failed_attempts += 1
        if user.failed_attempts >= max_attempts:
            user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=lockout_minutes)
        db.commit()
        db.refresh(user)
        return user

    @staticmethod
    def reset_failed_attempts(db: Session, user: User) -> User:
        """Resets failed attempt counter and clears lock on successful authentication."""
        user.failed_attempts = 0
        user.locked_until = None
        user.last_login_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(user)
        return user

    @staticmethod
    def save_refresh_token(
        db: Session,
        user_id: str,
        token_hash: str,
        expires_at: datetime,
        device: Optional[str] = None,
    ) -> RefreshToken:
        """Persists a hashed refresh token in the database [PDF 5.1, 9]."""
        token_row = RefreshToken(
            user_id=user_id,
            token_hash=token_hash,
            expires_at=expires_at,
            revoked_at=None,
            device=device,
        )
        db.add(token_row)
        db.commit()
        db.refresh(token_row)
        return token_row

    @staticmethod
    def get_refresh_token(db: Session, token_hash: str) -> Optional[RefreshToken]:
        """Finds a refresh token by its SHA-256 hash."""
        return db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()

    @staticmethod
    def revoke_refresh_token(db: Session, token_row: RefreshToken) -> None:
        """Marks a refresh token as revoked (rotation) [PDF 9]."""
        token_row.revoked_at = datetime.now(timezone.utc)
        db.commit()

    @staticmethod
    def revoke_all_user_refresh_tokens(db: Session, user_id: str) -> None:
        """Revokes all active refresh tokens for a user (e.g., after password reset) [PDF 9]."""
        now = datetime.now(timezone.utc)
        db.query(RefreshToken).filter(
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
        ).update({"revoked_at": now})
        db.commit()

    @staticmethod
    def save_password_reset_token(
        db: Session,
        user_id: str,
        token_hash: str,
        expires_at: datetime,
        requested_ip: Optional[str] = None,
    ) -> PasswordResetToken:
        """Persists a hashed password reset token (30-min lifespan) [PDF 5.1, 9]."""
        reset_row = PasswordResetToken(
            user_id=user_id,
            token_hash=token_hash,
            expires_at=expires_at,
            used_at=None,
            requested_ip=requested_ip,
        )
        db.add(reset_row)
        db.commit()
        db.refresh(reset_row)
        return reset_row

    @staticmethod
    def get_password_reset_token(db: Session, token_hash: str) -> Optional[PasswordResetToken]:
        """Finds a password reset token by its SHA-256 hash."""
        return db.query(PasswordResetToken).filter(PasswordResetToken.token_hash == token_hash).first()

    @staticmethod
    def mark_password_reset_token_used(db: Session, token_row: PasswordResetToken) -> None:
        """Marks a password reset token as used (single-use) [PDF 9]."""
        token_row.used_at = datetime.now(timezone.utc)
        db.commit()

    @staticmethod
    def update_password(db: Session, user: User, new_password_hash: str) -> User:
        """Updates user's password and resets failed attempt lockout counters [PDF 9]."""
        user.password_hash = new_password_hash
        user.failed_attempts = 0
        user.locked_until = None
        user.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(user)
        return user
