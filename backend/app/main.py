"""
Main FastAPI Application Entrypoint.
Initializes the application, registers middleware, configures global error handlers,
and defines system health and diagnostic endpoints.
"""
from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from app.core.config import settings
from app.core.db import check_db_connection
from app.core.errors import setup_exception_handlers

app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    description="Modular monolith REST API for Subscription Management System (Brightloop).",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
)

# Configure CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Global Exception Handlers for uniform JSON response envelopes
setup_exception_handlers(app)

# Register Module Routers
from app.modules.auth.router import router as auth_router
from app.modules.users.router import router as users_router
from app.modules.audit.router import router as audit_router
from app.modules.catalog.router import router as catalog_router
from app.modules.plans.router import router as plans_router
from app.modules.taxes.router import router as taxes_router
from app.modules.customers.router import router as customers_router, portal_router as customer_portal_router
from app.modules.quotation_templates.router import router as quotation_templates_router
from app.modules.subscriptions.router import router as subscriptions_router
from app.modules.discounts.router import router as discounts_router
from app.modules.billing.router import router as billing_router
from app.modules.payments.router import router as payments_router
from app.modules.reports.router import router as reports_router

app.include_router(auth_router, prefix=settings.API_V1_STR)
app.include_router(users_router, prefix=settings.API_V1_STR)
app.include_router(audit_router, prefix=settings.API_V1_STR)
app.include_router(catalog_router, prefix=settings.API_V1_STR)
app.include_router(plans_router, prefix=settings.API_V1_STR)
app.include_router(taxes_router, prefix=settings.API_V1_STR)
app.include_router(customers_router, prefix=settings.API_V1_STR)
app.include_router(customer_portal_router, prefix=settings.API_V1_STR)
app.include_router(quotation_templates_router, prefix=settings.API_V1_STR)
app.include_router(subscriptions_router, prefix=settings.API_V1_STR)
app.include_router(discounts_router, prefix=settings.API_V1_STR)
app.include_router(billing_router, prefix=settings.API_V1_STR)
app.include_router(payments_router, prefix=settings.API_V1_STR)
app.include_router(reports_router, prefix=settings.API_V1_STR)


@app.get("/docs", include_in_schema=False)
def redirect_to_docs():
    return RedirectResponse(url=f"{settings.API_V1_STR}/docs")


@app.get("/", tags=["Root"])
def root_endpoint():
    """Root metadata discovery endpoint."""
    return {
        "title": settings.PROJECT_NAME,
        "version": "1.0.0",
        "docs_url": f"{settings.API_V1_STR}/docs",
        "api_v1": settings.API_V1_STR,
        "status": "online",
    }


@app.get("/health", tags=["Health"])
@app.get(f"{settings.API_V1_STR}/health", tags=["Health"])
def health_check():
    """
    Evaluator Health Check Probe.
    Checks relational database connectivity and reports operational status.
    """
    db_healthy = check_db_connection()
    return {
        "status": "healthy" if db_healthy else "degraded",
        "database": "connected" if db_healthy else "unreachable",
        "project": settings.PROJECT_NAME,
        "currency": settings.DEFAULT_CURRENCY,
        "service_uptime": "online",
    }
