"""
Pydantic v2 Schemas for Staff Provisioning and User Management [PDF 2, 8, 9].
"""
import re
from typing import Optional
from pydantic import BaseModel, Field, field_validator
from app.modules.auth.models import UserRole

PASSWORD_REGEX = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$")
EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")


class StaffCreateRequest(BaseModel):
    """Staff account creation request (Admin only) [PDF 2, 8, 9]."""
    email: str = Field(..., description="Staff work email address")
    password: str = Field(..., description="Initial password meeting complexity policy")
    role: UserRole = Field(default=UserRole.STAFF, description="Role: 'staff' or 'admin'")

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

    @field_validator("role")
    @classmethod
    def validate_staff_role(cls, v: UserRole) -> UserRole:
        if v not in (UserRole.ADMIN, UserRole.STAFF):
            raise ValueError("Role must be either 'staff' or 'admin'. Cannot provision customer via this endpoint.")
        return v


class UserUpdateRequest(BaseModel):
    """Admin user update request (role or active status modification) [PDF 9]."""
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None
