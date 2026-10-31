"""
Security and Cryptography Utilities [PDF 5.1, 9].
Provides Argon2id password hashing, bcrypt verification fallback,
JWT access & refresh token generation/decoding, and SHA-256 token hashing.
"""
import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
import bcrypt
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
from app.core.config import settings
from app.core.errors import UnauthorizedError

logger = logging.getLogger(__name__)

# Primary Password Hasher: Argon2id (OWASP recommended gold standard) [PDF 9]
argon2_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
)


def hash_password(password: str) -> str:
    """Hashes a plain text password using Argon2id [PDF 9]."""
    return argon2_hasher.hash(password)


def hash_password_bcrypt(password: str) -> str:
    """Hashes a password using bcrypt (cost 12) as specified in [PDF 9]."""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verifies a plain text password against a stored hash.
    Supports Argon2id natively with backward-compatible bcrypt verification fallback [PDF 9].
    """
    if not hashed_password or not plain_password:
        return False

    # Check for Argon2id hash prefix
    if hashed_password.startswith("$argon2"):
        try:
            return argon2_hasher.verify(hashed_password, plain_password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False
        except Exception as e:
            logger.error(f"Unexpected error verifying Argon2 hash: {e}")
            return False

    # Check for bcrypt hash prefix ($2a$, $2b$, $2y$) [PDF 9]
    if hashed_password.startswith("$2"):
        try:
            return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
        except Exception as e:
            logger.error(f"Error verifying bcrypt hash: {e}")
            return False

    return False


def create_access_token(
    user_id: str,
    role: str,
    customer_id: Optional[str] = None,
    expires_delta: Optional[timedelta] = None,
) -> str:
    """
    Creates a signed JWT access token (15-minute standard expiration) [PDF 9].
    Encodes user_id, role, customer_id, and expiration timestamp.
    """
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    payload: Dict[str, Any] = {
        "sub": user_id,
        "role": role,
        "customer_id": customer_id,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "type": "access",
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> Dict[str, Any]:
    """
    Decodes and validates a JWT access token.
    Raises UnauthorizedError if expired, signature invalid, or malformed [PDF 9].
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
            options={"require": ["sub", "exp", "role"]},
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise UnauthorizedError("Access token has expired. Please refresh token or log in again.")
    except jwt.InvalidTokenError as e:
        raise UnauthorizedError(f"Invalid access token: {str(e)}")


def generate_secure_token() -> str:
    """Generates a cryptographically secure 256-bit random URL-safe token [PDF 9]."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """
    Computes SHA-256 hash of a reset or refresh token for secure database storage.
    Plain tokens are returned to client once; only their hashes are persisted in DB [PDF 5.1, 9].
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
