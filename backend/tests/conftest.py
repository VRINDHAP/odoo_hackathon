"""
Pytest configuration and central test fixtures [PDF 8, 11].
Owned by Vrindha.

Provides:
- In-memory SQLite SQLAlchemy engine & isolated database sessions.
- Pre-seeded test users (Admin, Staff, Customer).
- Pre-configured catalog entities: Plans with behavior flags (pausable, closable, auto_close),
  products, variants, and taxes.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import date, datetime
from decimal import Decimal
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Ensure backend root is on sys.path
backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.core.database import Base
from app.modules.auth.models import User, UserRole
from app.modules.plans.models import BillingPeriod, Plan
from app.modules.taxes.models import Tax, TaxType


@pytest.fixture(scope="function")
def db_session():
    """Provides a fresh isolated in-memory SQLite database session per test function."""
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def admin_user(db_session):
    """Admin role user fixture."""
    user = User(
        id=str(uuid.uuid4()),
        email=f"admin_{uuid.uuid4().hex[:6]}@brightloop.io",
        password_hash="testhash",
        role=UserRole.ADMIN,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def staff_user(db_session):
    """Internal Staff role user fixture."""
    user = User(
        id=str(uuid.uuid4()),
        email=f"staff_{uuid.uuid4().hex[:6]}@brightloop.io",
        password_hash="testhash",
        role=UserRole.STAFF,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def customer_user(db_session):
    """Customer role user fixture with linked customer_id."""
    customer_id = str(uuid.uuid4())
    user = User(
        id=str(uuid.uuid4()),
        email=f"customer_{uuid.uuid4().hex[:6]}@brightloop.io",
        password_hash="testhash",
        role=UserRole.CUSTOMER,
        customer_id=customer_id,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def sample_plans(db_session):
    """Catalog subscription plans with varying behavior flags."""
    standard_plan = Plan(
        id="plan-standard",
        name="Standard Monthly",
        price=Decimal("1000.00"),
        billing_period=BillingPeriod.MONTHLY,
        min_quantity=1,
        auto_close=False,
        closable=True,
        pausable=True,
        renewable=True,
        is_active=True,
    )
    strict_plan = Plan(
        id="plan-strict",
        name="Strict Lock-In Annual",
        price=Decimal("12000.00"),
        billing_period=BillingPeriod.YEARLY,
        min_quantity=1,
        auto_close=False,
        closable=False,
        pausable=False,
        renewable=False,
        is_active=True,
    )
    autoclose_plan = Plan(
        id="plan-autoclose",
        name="Fixed Term Trial",
        price=Decimal("500.00"),
        billing_period=BillingPeriod.MONTHLY,
        min_quantity=1,
        auto_close=True,
        closable=True,
        pausable=True,
        renewable=True,
        is_active=True,
    )
    db_session.add_all([standard_plan, strict_plan, autoclose_plan])
    db_session.commit()
    return {
        "standard": standard_plan,
        "strict": strict_plan,
        "autoclose": autoclose_plan,
    }


@pytest.fixture
def sample_tax(db_session):
    """Standard 18% Exclusive GST Tax fixture."""
    tax = Tax(
        id="tax-gst-18",
        name="GST 18%",
        rate=Decimal("18.00"),
        type=TaxType.EXCLUSIVE,
        is_active=True,
    )
    db_session.add(tax)
    db_session.commit()
    db_session.refresh(tax)
    return tax
