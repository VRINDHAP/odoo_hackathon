"""
API v1 Master Router Aggregator.
Consolidates all module routes under /api/v1.
"""
from fastapi import APIRouter

from app.modules.auth.router import router as auth_router
from app.modules.users.router import router as users_router
from app.modules.audit.router import router as audit_router
from app.modules.catalog.router import router as catalog_router
from app.modules.plans.router import router as plans_router
from app.modules.taxes.router import router as taxes_router
from app.modules.subscriptions.router import router as subscriptions_router
from app.modules.discounts.router import router as discounts_router
from app.modules.billing.router import router as billing_router
from app.modules.payments.router import router as payments_router

api_router = APIRouter()

# Authentication & Identity
api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(audit_router)

# Catalog & Master Data
api_router.include_router(catalog_router)
api_router.include_router(plans_router)
api_router.include_router(taxes_router)

# Subscriptions Engine
api_router.include_router(subscriptions_router)

# Discounts Engine
api_router.include_router(discounts_router)

# Automated Billing Engine
api_router.include_router(billing_router)

# Payments & Balance Management
api_router.include_router(payments_router)

