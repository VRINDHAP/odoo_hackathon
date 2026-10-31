"""
FastAPI Router for Reports & Financial Analytics (/api/v1/reports) [PDF 8, 10, 11].
"""
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import require_admin, require_staff_or_admin
from app.modules.auth.models import User
from app.modules.invoices.models import Invoice, InvoiceStatus
from app.modules.reports.schemas import (
    DashboardSummary,
    OutstandingReportResponse,
    OverdueReportResponse,
    PaymentsReportResponse,
    RevenueReportRow,
)
from app.modules.reports.service import ReportsService
from app.modules.subscriptions.models import Subscription
from app.modules.subscriptions.schemas import SubscriptionResponse

router = APIRouter(prefix="/reports", tags=["Reports"])


@router.get(
    "/summary",
    response_model=DashboardSummary,
    summary="Get Executive Summary KPI metrics with caching [PDF 10, 11]",
)
def get_reports_summary(
    months: int = Query(6, ge=1, le=24, description="Horizon months for trend analysis"),
    refresh: bool = Query(False, description="Bypass cache and force recompute"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
):
    """Computes real-time MRR, ARR, Invoiced, Collected, and aging analysis."""
    return ReportsService.get_dashboard_summary(db=db, months=months, force_refresh=refresh)


@router.get(
    "/active-subscriptions",
    summary="List active subscriptions or export CSV [PDF 8, 10]",
)
def get_active_subscriptions_report(
    format: Optional[str] = Query(None, description="Output format ('csv' or default json)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
):
    """Retrieves active subscriptions list or downloadable CSV file."""
    if format == "csv":
        csv_data = ReportsService.export_active_subscriptions_csv(db)
        return Response(
            content=csv_data,
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=active_subscriptions.csv"},
        )

    subs = (
        db.query(Subscription)
        .filter(func.lower(Subscription.status) == "active")
        .all()
    )
    return [SubscriptionResponse.model_validate(s) for s in subs]


@router.get(
    "/revenue",
    summary="Get monthly revenue breakdown or export CSV [PDF 8, 10]",
)
def get_revenue_report(
    format: Optional[str] = Query(None, description="Output format ('csv' or default json)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
):
    """Retrieves monthly revenue breakdown rows or downloadable CSV file."""
    if format == "csv":
        csv_data = ReportsService.export_revenue_report_csv(db)
        return Response(
            content=csv_data,
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=revenue_report.csv"},
        )

    invoices = db.query(Invoice).filter(Invoice.status != InvoiceStatus.CANCELLED).all()
    rows = []
    for inv in invoices:
        period_str = str(inv.invoice_date.strftime("%Y-%m")) if inv.invoice_date else "Unknown"
        rows.append(
            RevenueReportRow(
                period=period_str,
                plan_name="Subscription Recurring",
                product_name=f"Invoice {inv.number}",
                invoiced=str(inv.total),
                collected=str(inv.amount_paid),
            )
        )
    return rows


@router.get(
    "/overdue",
    response_model=OverdueReportResponse,
    summary="Get overdue invoices and aging analysis [PDF 7.5, 10]",
)
def get_overdue_report(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
):
    """Retrieves overdue invoice list and 0-30, 31-60, 61-90, 90+ days aging buckets."""
    return ReportsService.get_overdue_report(db)


@router.get(
    "/outstanding",
    response_model=OutstandingReportResponse,
    summary="Get unpaid invoice balances [PDF 10]",
)
def get_outstanding_report(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
):
    """Retrieves list of unpaid invoices and total outstanding balance."""
    return ReportsService.get_outstanding_report(db)


@router.get(
    "/payments",
    response_model=PaymentsReportResponse,
    summary="Get payments collected breakdown by method [PDF 10]",
)
def get_payments_report(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
):
    """Retrieves payment totals and counts grouped by payment method."""
    return ReportsService.get_payments_report(db)
