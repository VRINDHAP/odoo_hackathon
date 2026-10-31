"""
Authentication Domain Service (Business Rules Layer) [PDF 3, 8, 9].
Coordinates signup, credential verification, lockout, token issuance, and rotation.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.errors import ConflictError, ForbiddenError, UnauthorizedError
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    generate_secure_token,
    hash_token,
)
from app.modules.auth.models import UserRole
from app.modules.auth.repository import AuthRepository
from app.modules.auth.schemas import (
    SignupRequest,
    LoginRequest,
    AuthResponse,
    UserResponse,
)


class AuthService:
    """Service encapsulating identity business rules and security policies."""

    @staticmethod
    def signup(db: Session, request: SignupRequest) -> AuthResponse:
        """
        Registers a new customer account [PDF 8, 9].
        - Rejects duplicate email with HTTP 409 Conflict.
        - Enforces customer role.
        - Hashes password with Argon2id.
        - Issues 15-min JWT access token and 7-day rotating refresh token.
        """
        existing = AuthRepository.get_by_email(db, request.email)
        if existing:
            raise ConflictError("An account with this email address already exists.")

        hashed_pwd = hash_password(request.password)
        user = AuthRepository.create_customer_user(
            db=db,
            email=request.email,
            password_hash=hashed_pwd,
        )

        # Issue tokens
        access_token = create_access_token(
            user_id=user.id,
            role=user.role.value,
            customer_id=user.customer_id,
        )
        raw_refresh_token = generate_secure_token()
        refresh_expires = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

        AuthRepository.save_refresh_token(
            db=db,
            user_id=user.id,
            token_hash=hash_token(raw_refresh_token),
            expires_at=refresh_expires,
        )

        return AuthResponse(
            access_token=access_token,
            token_type="bearer",
            expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            refresh_token=raw_refresh_token,
            user=UserResponse.model_validate(user),
        )

    @staticmethod
    def login(db: Session, request: LoginRequest, device: Optional[str] = None) -> AuthResponse:
        """
        Authenticates user with lockout protection [PDF 5.1, 9].
        - Locks account after 5 consecutive failed attempts.
        - Anti-enumeration: returns generic 401 on non-existent account.
        - Issues fresh access token and rotating refresh token on success.
        """
        user = AuthRepository.get_by_email(db, request.email)
        if not user:
            raise UnauthorizedError("Invalid email or password.")

        if not user.is_active:
            raise ForbiddenError("Account is inactive. Please contact support.")

        now = datetime.now(timezone.utc)

        # Check if account is currently locked out [PDF 5.1, 9]
        if user.locked_until:
            # Normalize timezone comparison
            locked_until_utc = user.locked_until
            if locked_until_utc.tzinfo is None:
                locked_until_utc = locked_until_utc.replace(tzinfo=timezone.utc)

            if locked_until_utc > now:
                remaining_sec = int((locked_until_utc - now).total_seconds())
                remaining_min = max(1, (remaining_sec // 60) + 1)
                raise ForbiddenError(
                    f"Account is temporarily locked due to repeated failed logins. "
                    f"Please try again in {remaining_min} minute(s)."
                )

        # Verify password using Argon2id with bcrypt fallback
        if not verify_password(request.password, user.password_hash):
            user = AuthRepository.increment_failed_attempts(
                db=db,
                user=user,
                max_attempts=settings.MAX_FAILED_LOGIN_ATTEMPTS,
                lockout_minutes=settings.ACCOUNT_LOCKOUT_MINUTES,
            )
            if user.failed_attempts >= settings.MAX_FAILED_LOGIN_ATTEMPTS:
                raise ForbiddenError(
                    f"Account locked for {settings.ACCOUNT_LOCKOUT_MINUTES} minutes "
                    f"after {settings.MAX_FAILED_LOGIN_ATTEMPTS} failed attempts."
                )
            raise UnauthorizedError("Invalid email or password.")

        # Authentication succeeded: reset lockout counters
        user = AuthRepository.reset_failed_attempts(db=db, user=user)

        # Issue tokens
        access_token = create_access_token(
            user_id=user.id,
            role=user.role.value,
            customer_id=user.customer_id,
        )
        raw_refresh_token = generate_secure_token()
        refresh_expires = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

        AuthRepository.save_refresh_token(
            db=db,
            user_id=user.id,
            token_hash=hash_token(raw_refresh_token),
            expires_at=refresh_expires,
            device=device,
        )

        return AuthResponse(
            access_token=access_token,
            token_type="bearer",
            expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            refresh_token=raw_refresh_token,
            user=UserResponse.model_validate(user),
        )

    @staticmethod
    def refresh_token(db: Session, raw_token: str, device: Optional[str] = None) -> AuthResponse:
        """
        Exchanges a 7-day refresh token for a new access token and rotates the refresh token [PDF 9].
        Old refresh token is revoked immediately.
        """
        token_hash = hash_token(raw_token)
        token_row = AuthRepository.get_refresh_token(db, token_hash)

        if not token_row:
            raise UnauthorizedError("Invalid or expired refresh token.")

        if token_row.revoked_at is not None:
            # Token reuse detected! Revoke all sessions for security [PDF 9]
            AuthRepository.revoke_all_user_refresh_tokens(db, token_row.user_id)
            raise UnauthorizedError("Refresh token was previously revoked. All active sessions invalidated for security.")

        now = datetime.now(timezone.utc)
        expires_at = token_row.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)

        if expires_at < now:
            raise UnauthorizedError("Refresh token has expired. Please log in again.")

        user = AuthRepository.get_by_id(db, token_row.user_id)
        if not user or not user.is_active:
            raise UnauthorizedError("User account no longer active.")

        # Rotate token: revoke old token and issue fresh token pair [PDF 9]
        AuthRepository.revoke_refresh_token(db, token_row)

        new_access_token = create_access_token(
            user_id=user.id,
            role=user.role.value,
            customer_id=user.customer_id,
        )
        new_raw_refresh = generate_secure_token()
        new_expires = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

        AuthRepository.save_refresh_token(
            db=db,
            user_id=user.id,
            token_hash=hash_token(new_raw_refresh),
            expires_at=new_expires,
            device=device,
        )

        return AuthResponse(
            access_token=new_access_token,
            token_type="bearer",
            expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            refresh_token=new_raw_refresh,
            user=UserResponse.model_validate(user),
        )

    @staticmethod
    def logout(db: Session, raw_token: str) -> None:
        """Revokes a refresh token, invalidating the session [PDF 9]."""
        token_hash = hash_token(raw_token)
        token_row = AuthRepository.get_refresh_token(db, token_hash)
        if token_row and token_row.revoked_at is None:
            AuthRepository.revoke_refresh_token(db, token_row)

    @staticmethod
    def forgot_password(db: Session, email: str, ip: Optional[str] = None) -> tuple[str, Optional[str]]:
        """
        Initiates password reset flow [PDF 8, 9].
        Always returns constant generic message: 'If the email exists, a link was sent'
        to prevent account enumeration.
        """
        constant_message = "If the email exists, a link was sent."
        user = AuthRepository.get_by_email(db, email)
        raw_token = None

        if user and user.is_active:
            raw_token = generate_secure_token()
            expires_at = datetime.now(timezone.utc) + timedelta(
                minutes=settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES
            )
            AuthRepository.save_password_reset_token(
                db=db,
                user_id=user.id,
                token_hash=hash_token(raw_token),
                expires_at=expires_at,
                requested_ip=ip,
            )

        return constant_message, raw_token

    @staticmethod
    def reset_password(db: Session, raw_token: str, new_password: str) -> str:
        """
        Completes password reset [PDF 8, 9].
        - Verifies single-use 256-bit token.
        - Hashes new password with Argon2id.
        - Marks token as used.
        - Revokes ALL active refresh tokens for the user.
        """
        token_hash = hash_token(raw_token)
        token_row = AuthRepository.get_password_reset_token(db, token_hash)

        if not token_row or token_row.used_at is not None:
            raise UnauthorizedError("Password reset link is invalid or has already been used.")

        now = datetime.now(timezone.utc)
        expires_at = token_row.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)

        if expires_at < now:
            raise UnauthorizedError("Password reset link has expired. Please request a new one.")

        user = AuthRepository.get_by_id(db, token_row.user_id)
        if not user or not user.is_active:
            raise UnauthorizedError("Account not found or inactive.")

        # Update password with Argon2id and reset failed attempts
        new_hash = hash_password(new_password)
        AuthRepository.update_password(db, user, new_hash)

        # Mark token as used
        AuthRepository.mark_password_reset_token_used(db, token_row)

        # Revoke all active refresh tokens for the user [PDF 9]
        AuthRepository.revoke_all_user_refresh_tokens(db, user.id)

        return "Password has been successfully reset. Please log in with your new password."
