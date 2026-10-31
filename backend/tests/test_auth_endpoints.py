"""
Integration Tests for BE-1.3 & BE-1.4: Auth Endpoints, Password Policy, and Account Lockout [PDF 5.1, 8, 9].
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.db import engine, Base, SessionLocal
from app.modules.auth.models import User, UserRole

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_db():
    """Ensure database tables exist and clean up users between tests."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        db.query(User).filter(User.email.like("authtest_%@brightloop.io")).delete()
        db.commit()
    finally:
        db.close()
    yield


def test_signup_success():
    """Verify public signup creates customer role and issues JWT token [PDF 8, 9]."""
    payload = {
        "email": "authtest_cust1@brightloop.io",
        "password": "StrongPassword!2026",
    }
    response = client.post("/api/v1/auth/signup", json=payload)
    assert response.status_code == 201
    data = response.json()

    assert "access_token" in data
    assert "refresh_token" in data
    assert data["token_type"] == "bearer"
    assert data["expires_in"] == 900
    assert data["user"]["email"] == payload["email"]
    # Critical hackathon check: public signup MUST strictly be customer role [PDF 9]
    assert data["user"]["role"] == "customer"


def test_signup_weak_password_rejected():
    """Verify password regex ^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$ enforces policy [PDF 8, 9]."""
    # Too short (< 9 chars)
    res1 = client.post("/api/v1/auth/signup", json={"email": "authtest_bad1@brightloop.io", "password": "Short!1"})
    assert res1.status_code == 422
    assert res1.json()["code"] == "VALIDATION_ERROR"

    # Lacks special char
    res2 = client.post("/api/v1/auth/signup", json={"email": "authtest_bad2@brightloop.io", "password": "NoSpecialChar123"})
    assert res2.status_code == 422

    # Lacks uppercase
    res3 = client.post("/api/v1/auth/signup", json={"email": "authtest_bad3@brightloop.io", "password": "nouppercase!123"})
    assert res3.status_code == 422


def test_signup_duplicate_email_returns_409():
    """Verify duplicate email returns HTTP 409 Conflict [PDF 8, 11]."""
    payload = {
        "email": "authtest_duplicate@brightloop.io",
        "password": "SecurePassword!99",
    }
    first_res = client.post("/api/v1/auth/signup", json=payload)
    assert first_res.status_code == 201

    # Second signup with same email (even with different casing)
    second_res = client.post(
        "/api/v1/auth/signup",
        json={"email": "AuthTest_Duplicate@brightloop.io", "password": "SecurePassword!99"},
    )
    assert second_res.status_code == 409
    data = second_res.json()
    assert data["code"] == "CONFLICT"
    assert "already exists" in data["message"].lower()


def test_login_success_and_token_response():
    """Verify valid login returns access and refresh tokens [PDF 8]."""
    email = "authtest_login@brightloop.io"
    password = "ValidPassword!2026"

    # Register first
    client.post("/api/v1/auth/signup", json={"email": email, "password": password})

    # Log in
    res = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["user"]["email"] == email


def test_login_invalid_password_returns_401():
    """Verify invalid password returns HTTP 401 Unauthorized without leaking account status."""
    email = "authtest_wrongpwd@brightloop.io"
    password = "CorrectPassword!2026"
    client.post("/api/v1/auth/signup", json={"email": email, "password": password})

    res = client.post("/api/v1/auth/login", json={"email": email, "password": "WrongPassword#999"})
    assert res.status_code == 401
    assert res.json()["code"] == "UNAUTHORIZED"


def test_account_lockout_after_5_failures():
    """Verify account locks for 15 minutes after 5 consecutive failed logins [PDF 5.1, 9]."""
    email = "authtest_lockout@brightloop.io"
    password = "TargetPassword!2026"
    client.post("/api/v1/auth/signup", json={"email": email, "password": password})

    # Fail 4 times (returns 401)
    for _ in range(4):
        res = client.post("/api/v1/auth/login", json={"email": email, "password": "BadAttempt#123"})
        assert res.status_code == 401

    # 5th failed attempt triggers lockout (returns 403 Forbidden)
    res_fifth = client.post("/api/v1/auth/login", json={"email": email, "password": "BadAttempt#123"})
    assert res_fifth.status_code == 403
    assert "locked" in res_fifth.json()["message"].lower()

    # Even with the CORRECT password, locked account is blocked
    res_locked = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res_locked.status_code == 403
    assert "locked" in res_locked.json()["message"].lower()


def test_refresh_token_rotation_and_revocation():
    """Verify rotating refresh token: burns old token, issues new token pair [PDF 9]."""
    email = "authtest_rotate@brightloop.io"
    password = "RotationPassword!2026"
    signup_res = client.post("/api/v1/auth/signup", json={"email": email, "password": password})
    original_refresh = signup_res.json()["refresh_token"]

    # Exchange refresh token
    rotate_res = client.post("/api/v1/auth/refresh", json={"refresh_token": original_refresh})
    assert rotate_res.status_code == 200
    rotated_data = rotate_res.json()
    new_refresh = rotated_data["refresh_token"]

    # New refresh token must be different from original
    assert new_refresh != original_refresh
    assert "access_token" in rotated_data

    # Attempting to reuse the original burned token must fail with 401
    reuse_res = client.post("/api/v1/auth/refresh", json={"refresh_token": original_refresh})
    assert reuse_res.status_code == 401
    assert "revoked" in reuse_res.json()["message"].lower()


def test_logout_revokes_token():
    """Verify logout explicitly invalidates refresh token [PDF 9]."""
    email = "authtest_logout@brightloop.io"
    password = "LogoutPassword!2026"
    login_res = client.post("/api/v1/auth/signup", json={"email": email, "password": password})
    refresh_token = login_res.json()["refresh_token"]

    # Logout
    logout_res = client.post("/api/v1/auth/logout", json={"refresh_token": refresh_token})
    assert logout_res.status_code == 200
    assert "logged out" in logout_res.json()["message"].lower()

    # Refresh with logged-out token must fail
    try_refresh = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert try_refresh.status_code == 401
