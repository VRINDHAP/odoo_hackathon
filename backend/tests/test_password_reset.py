"""
Unit & Integration Tests for BE-1.5: Forgot and Reset Password Flow with Anti-Enumeration [PDF 8, 9].
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.db import engine, Base, SessionLocal
from app.core.security import hash_token
from app.modules.auth.models import User, PasswordResetToken

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        db.query(User).filter(User.email.like("resettest_%@brightloop.io")).delete()
        db.commit()
    finally:
        db.close()
    yield


def test_forgot_password_anti_enumeration():
    """Verify forgot-password returns constant generic response regardless of existence [PDF 9]."""
    # 1. Non-existent email
    res1 = client.post("/api/v1/auth/forgot-password", json={"email": "resettest_nonexistent@brightloop.io"})
    assert res1.status_code == 200
    assert "If the email exists, a link was sent" in res1.json()["message"]

    # 2. Existing registered email
    email = "resettest_exists@brightloop.io"
    client.post("/api/v1/auth/signup", json={"email": email, "password": "OriginalPassword#1"})

    res2 = client.post("/api/v1/auth/forgot-password", json={"email": email})
    assert res2.status_code == 200
    # Responses must be identical to prevent account enumeration attacks
    assert res1.json()["message"] == res2.json()["message"]


def test_password_reset_flow_and_session_revocation():
    """Verify valid token resets password and revokes all active refresh tokens [PDF 9]."""
    email = "resettest_flow@brightloop.io"
    old_pwd = "OldPassword#123"
    new_pwd = "NewPassword#2026"

    # Sign up and acquire refresh token
    signup_res = client.post("/api/v1/auth/signup", json={"email": email, "password": old_pwd})
    active_refresh = signup_res.json()["refresh_token"]

    # Request password reset
    client.post("/api/v1/auth/forgot-password", json={"email": email})

    # Retrieve reset token from DB
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        reset_row = db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user.id).first()
        assert reset_row is not None
        assert reset_row.used_at is None
    finally:
        db.close()

    # In our service, the raw token was hashed before storing.
    # To test the reset endpoint, let's trigger service directly to get the generated raw token
    from app.modules.auth.service import AuthService
    db = SessionLocal()
    try:
        _, raw_token = AuthService.forgot_password(db, email)
        assert raw_token is not None
    finally:
        db.close()

    # Call reset password endpoint
    reset_res = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_token, "new_password": new_pwd},
    )
    assert reset_res.status_code == 200
    assert "successfully reset" in reset_res.json()["message"].lower()

    # 1. Login with old password must fail
    res_old = client.post("/api/v1/auth/login", json={"email": email, "password": old_pwd})
    assert res_old.status_code == 401

    # 2. Login with new password must succeed
    res_new = client.post("/api/v1/auth/login", json={"email": email, "password": new_pwd})
    assert res_new.status_code == 200

    # 3. Old refresh token must be revoked [PDF 9]
    res_refresh = client.post("/api/v1/auth/refresh", json={"refresh_token": active_refresh})
    assert res_refresh.status_code == 401

    # 4. Reusing the same reset token must fail
    res_reuse = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_token, "new_password": "AnotherPassword#2026"},
    )
    assert res_reuse.status_code == 401
