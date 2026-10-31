"""
Unit Tests for BE-1.2: Password Hashing, JWT Tokens, and Identity ORM Models.
"""
from datetime import datetime, timedelta
import pytest
from passlib.hash import bcrypt
from app.core.db import engine, Base, SessionLocal
from app.core.errors import UnauthorizedError
from app.core.security import (
    hash_password,
    hash_password_bcrypt,
    verify_password,
    create_access_token,
    decode_access_token,
    generate_secure_token,
    hash_token,
)
from app.modules.auth.models import User, UserRole, PasswordResetToken, RefreshToken


@pytest.fixture(autouse=True)
def setup_tables():
    """Ensure database tables exist for tests."""
    Base.metadata.create_all(bind=engine)
    yield
    # Tables can remain or be cleared between tests


def test_argon2_password_hashing():
    """Verify Argon2id produces valid hash and verifies correctly [PDF 9]."""
    raw_password = "BrightloopPassword#2026"
    hashed = hash_password(raw_password)

    # Must start with $argon2id$
    assert hashed.startswith("$argon2id$")
    assert hashed != raw_password

    # Correct password succeeds
    assert verify_password(raw_password, hashed) is True

    # Incorrect password fails
    assert verify_password("WrongPassword#123", hashed) is False

    # Empty inputs fail safely
    assert verify_password("", hashed) is False
    assert verify_password(raw_password, "") is False


def test_bcrypt_backward_compatibility():
    """Verify verify_password accepts legacy bcrypt hashes as fallback [PDF 9]."""
    raw = "OldPassword123!"
    bcrypt_hash = hash_password_bcrypt(raw)
    assert bcrypt_hash.startswith("$2b$12$")
    assert verify_password(raw, bcrypt_hash) is True
    assert verify_password("InvalidPassword", bcrypt_hash) is False


def test_jwt_access_token_generation_and_claims():
    """Verify JWT access token encodes claims and decodes cleanly [PDF 9]."""
    user_id = "test-user-uuid-1"
    role = "admin"
    customer_id = "test-cust-uuid-1"

    token = create_access_token(user_id=user_id, role=role, customer_id=customer_id)
    assert isinstance(token, str)
    assert len(token) > 20

    claims = decode_access_token(token)
    assert claims["sub"] == user_id
    assert claims["role"] == role
    assert claims["customer_id"] == customer_id
    assert "exp" in claims
    assert "iat" in claims


def test_jwt_expired_token_raises_unauthorized():
    """Verify expired token raises standard UnauthorizedError [PDF 9]."""
    token = create_access_token(
        user_id="user-expired",
        role="customer",
        expires_delta=timedelta(seconds=-10),
    )
    with pytest.raises(UnauthorizedError) as exc_info:
        decode_access_token(token)
    assert "expired" in exc_info.value.message.lower()


def test_secure_token_and_sha256_hash():
    """Verify high-entropy random token and SHA-256 deterministic hash [PDF 5.1, 9]."""
    token1 = generate_secure_token()
    token2 = generate_secure_token()
    assert token1 != token2
    assert len(token1) >= 40

    hashed1 = hash_token(token1)
    # SHA-256 hex digest is exactly 64 characters
    assert len(hashed1) == 64
    assert hash_token(token1) == hashed1  # Deterministic
    assert hash_token(token2) != hashed1


def test_user_and_token_orm_lifecycle():
    """Verify User and RefreshToken ORM models persist and query correctly."""
    db = SessionLocal()
    try:
        test_email = "tester@brightloop.io"
        # Clean up any existing record
        db.query(User).filter(User.email == test_email).delete()
        db.commit()

        # Create new User
        user = User(
            email=test_email,
            password_hash=hash_password("SuperSecret99#"),
            role=UserRole.ADMIN,
            is_active=True,
            failed_attempts=0,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        assert user.id is not None
        assert user.role == UserRole.ADMIN

        # Attach RefreshToken
        raw_refresh = generate_secure_token()
        refresh_row = RefreshToken(
            user_id=user.id,
            token_hash=hash_token(raw_refresh),
            expires_at=datetime.utcnow() + timedelta(days=7),
            device="Mozilla/5.0 TestClient",
        )
        db.add(refresh_row)
        db.commit()

        # Query user and assert relationship
        loaded_user = db.query(User).filter(User.email == test_email).first()
        assert loaded_user is not None
        assert len(loaded_user.refresh_tokens) == 1
        assert loaded_user.refresh_tokens[0].token_hash == hash_token(raw_refresh)

        # Clean up
        db.delete(loaded_user)
        db.commit()
    finally:
        db.close()
