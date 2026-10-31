"""
Authentication API Endpoints (/api/v1/auth) [PDF 8, 9].
Handles signup, login, refresh, and logout with uniform error responses.
"""
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session
from app.core.deps import get_db
from app.modules.auth.schemas import (
    SignupRequest,
    LoginRequest,
    TokenRefreshRequest,
    AuthResponse,
    MessageResponse,
)
from app.modules.auth.service import AuthService

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post(
    "/signup",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new customer account [PDF 8, 9]",
)
def signup(request: SignupRequest, db: Session = Depends(get_db)):
    """
    Public signup endpoint:
    - Enforces customer role strictly.
    - Validates password length > 8 with uppercase, lowercase, and special character.
    - Rejects duplicate emails with HTTP 409 Conflict.
    """
    return AuthService.signup(db=db, request=request)


@router.post(
    "/login",
    response_model=AuthResponse,
    status_code=status.HTTP_200_OK,
    summary="User login with account lockout protection [PDF 8, 9]",
)
def login(request: LoginRequest, req: Request, db: Session = Depends(get_db)):
    """
    User login endpoint:
    - Verifies password using Argon2id (with bcrypt fallback).
    - Locks account for 15 minutes after 5 consecutive failed attempts.
    - Returns 15-min JWT access token and 7-day rotating refresh token.
    """
    user_agent = req.headers.get("user-agent", "Unknown Device")
    return AuthService.login(db=db, request=request, device=user_agent)


@router.post(
    "/refresh",
    response_model=AuthResponse,
    status_code=status.HTTP_200_OK,
    summary="Exchange refresh token for new access and rotated refresh token [PDF 8, 9]",
)
def refresh_token(request: TokenRefreshRequest, req: Request, db: Session = Depends(get_db)):
    """
    Rotating refresh token endpoint:
    - Burns the submitted refresh token.
    - Issues a brand new refresh token and 15-minute access token.
    - Detects token reuse and revokes all active user sessions on reuse.
    """
    user_agent = req.headers.get("user-agent", "Unknown Device")
    return AuthService.refresh_token(db=db, raw_token=request.refresh_token, device=user_agent)


@router.post(
    "/logout",
    response_model=MessageResponse,
    status_code=status.HTTP_200_OK,
    summary="Revoke refresh token and invalidate session [PDF 8, 9]",
)
def logout(request: TokenRefreshRequest, db: Session = Depends(get_db)):
    """
    Logout endpoint:
    - Explicitly revokes the refresh token in the database.
    """
    AuthService.logout(db=db, raw_token=request.refresh_token)
    return MessageResponse(message="Successfully logged out and session revoked.")
