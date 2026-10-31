"""
Pydantic v2 Validation Schemas for Authentication and Identity [PDF 8, 9, 11].
Enforces strict email regex and password complexity regex:
^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$
"""
import re
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, field_validator, ConfigDict

PASSWORD_REGEX = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$")
EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")


class SignupRequest(BaseModel):
    """Public customer registration request [PDF 8, 9]."""
    email: str = Field(..., description="Valid user email address")
    password: str = Field(..., description="Password must be > 8 chars with uppercase, lowercase, and special char")

    @field_validator("email")
    @classmethod
    def validate_email_format(cls, v: str) -> str:
        cleaned = v.strip().lower()
        if not EMAIL_REGEX.match(cleaned):
            raise ValueError("Invalid email address format.")
        return cleaned

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        if not PASSWORD_REGEX.match(v):
            raise ValueError(
                "Password must be longer than 8 characters, contain at least one uppercase letter, "
                "one lowercase letter, and one special character."
            )
        return v


class LoginRequest(BaseModel):
    """User authentication request [PDF 8]."""
    email: str = Field(..., description="Registered email address")
    password: str = Field(..., description="Account password")

    @field_validator("email")
    @classmethod
    def validate_email_format(cls, v: str) -> str:
        cleaned = v.strip().lower()
        if not EMAIL_REGEX.match(cleaned):
            raise ValueError("Invalid email address format.")
        return cleaned


class TokenRefreshRequest(BaseModel):
    """Refresh token submission request [PDF 8, 9]."""
    refresh_token: str = Field(..., description="The plain rotating refresh token string")


class UserResponse(BaseModel):
    """Public user profile response [PDF 8]."""
    id: str
    email: str
    role: str
    customer_id: Optional[str] = None
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AuthResponse(BaseModel):
    """Authentication token envelope returned on signup, login, and refresh [PDF 8]."""
    access_token: str
    token_type: str = "bearer"
    expires_in: int = 900  # 15 minutes [PDF 9]
    refresh_token: str
    user: UserResponse


class MessageResponse(BaseModel):
    """Generic message response."""
    message: str
