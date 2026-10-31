"""
Central Database Metadata & Model Registry.
Imports all models so that SQLAlchemy Base.metadata detects all tables
for Alembic migrations and Base.metadata.create_all().
"""
from app.core.db import Base, SessionLocal, check_db_connection, engine, get_db

# Identity & Auth
from app.modules.auth.models import PasswordResetToken, RefreshToken, User

# Audit
from app.modules.audit.models import AuditLog

# Catalog, Plans, Taxes
try:
    from app.modules.catalog.models import Product, ProductVariant
except ImportError:
    pass

try:
    from app.modules.plans.models import Plan
except ImportError:
    pass

try:
    from app.modules.taxes.models import Tax
except ImportError:
    pass

# Subscriptions Engine
from app.modules.subscriptions.models import Subscription, SubscriptionLine, SubscriptionStatus

# Discounts Engine
from app.modules.discounts.models import (
    DiscountProduct,
    DiscountRedemption,
    DiscountRule,
    DiscountScope,
    DiscountType,
)

# Automated Billing & Invoices
from app.modules.invoices.models import Invoice, InvoiceLine, InvoiceStatus
from app.modules.billing.models import BillingRun

# Payments Engine
from app.modules.payments.models import Payment, PaymentMethod, PaymentStatus

__all__ = [
    "Base",
    "engine",
    "SessionLocal",
    "get_db",
    "check_db_connection",
    # Core Models
    "User",
    "AuditLog",
    "Subscription",
    "SubscriptionLine",
    "SubscriptionStatus",
    "DiscountRule",
    "DiscountProduct",
    "DiscountRedemption",
    "DiscountType",
    "DiscountScope",
    "Invoice",
    "InvoiceLine",
    "InvoiceStatus",
    "BillingRun",
    "Payment",
    "PaymentMethod",
    "PaymentStatus",
]

