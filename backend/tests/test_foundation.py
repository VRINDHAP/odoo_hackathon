"""
Unit and Integration Tests for BE-1.1 Foundation.
Tests configuration loading, database session generator, error handlers, and health endpoints.
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings
from app.core.db import get_db, SessionLocal
from app.core.errors import NotFoundError, ValidationError, ConflictError


client = TestClient(app)


def test_root_endpoint():
    """Verify root endpoint returns 200 with metadata."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert "version" in data
    assert data["docs_url"] == "/api/v1/docs"


def test_health_check_endpoint():
    """Verify health check returns status and database connectivity indicator."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "database" in data
    assert data["currency"] == settings.DEFAULT_CURRENCY


def test_standard_404_error_envelope():
    """Verify non-existent route returns standard error envelope {code, message, fields}."""
    response = client.get("/api/v1/non-existent-route-xyz")
    assert response.status_code == 404
    data = response.json()
    assert data["code"] == "NOT_FOUND"
    assert "message" in data
    assert isinstance(data["fields"], list)


def test_database_session_generator():
    """Verify get_db generator yields active session and closes cleanly."""
    gen = get_db()
    db = next(gen)
    assert db is not None
    # Execute a lightweight probe
    from sqlalchemy import text
    result = db.execute(text("SELECT 1")).scalar()
    assert result == 1
    # Finish generator (invokes finally: db.close())
    with pytest.raises(StopIteration):
        next(gen)
