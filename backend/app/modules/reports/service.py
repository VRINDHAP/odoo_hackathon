"""
Reports & Financial Calculation Service [PDF 10, 11].
Implements MRR/ARR Normalization, KPI mosaics, Aging analysis, and CSV streaming exports.
"""
from __future__ import annotations

import csv
import io
import time
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.customers.models import Customer
from app.modules.invoices.models import Invoice, InvoiceStatus
from app.modules.payments.models import Payment, PaymentStatus
from app.modules.plans.models import BillingPeriod, Plan
from app.modules.reports.schemas import (
    AgingBucketSummary,
    DashboardSummary,
    OutstandingReportResponse,
    OverdueReportResponse,
    PaymentsByMethodItem,
    PaymentsReportResponse,
    RevenueReportRow,
    RevenueTrendItem,
)
from app.modules.subscriptions.models import Subscription, SubscriptionStatus


# In-memory KPI cache with 3-minute TTL [PDF 10, 11]
_CACHE_DATA: Optional[DashboardSummary] = None
_CACHE_EXPIRY: float = 0.0


class ReportsService:
    """Service layer computing normalized SaaS metrics and financial reports."""

    @classmethod
    def calculate_mrr_arr(cls, db: Session) -> Tuple[Decimal, Decimal]:
        """
        Normalizes MRR across mixed portfolios [PDF 10]:
        - Monthly: amount * 1
        - Yearly: amount / 12
        - Weekly: amount * 52 / 12
        - Daily: amount * 365 / 12
        Strictly excludes paused, draft, and closed subscriptions.
        """
        active_subs = (
            db.query(Subscription)
            .filter(func.lower(Subscription.status) == "active")
            .all()
        )

        total_mrr = Decimal("0.00")
        for sub in active_subs:
            sub_total = Decimal(str(sub.total_amount or "0.00"))
            plan = db.query(Plan).filter(Plan.id == sub.plan_id).first()
            period = str(plan.billing_period.value if hasattr(plan.billing_period, "value") else plan.billing_period).lower() if plan else "monthly"

            if period == "yearly":
                normalized = sub_total / Decimal("12")
            elif period == "weekly":
                normalized = (sub_total * Decimal("52")) / Decimal("12")
            elif period == "daily":
                normalized = (sub_total * Decimal("365")) / Decimal("12")
            else:
                # monthly
                normalized = sub_total

            total_mrr += normalized

        total_mrr = total_mrr.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        total_arr = (total_mrr * Decimal("12")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return total_mrr, total_arr

    @classmethod
    def get_dashboard_summary(
        cls,
        db: Session,
        months: int = 6,
        force_refresh: bool = False,
    ) -> DashboardSummary:
        """
        Computes executive KPI metrics with caching [PDF 10, 11].
        """
        global _CACHE_DATA, _CACHE_EXPIRY
        now = time.time()
        if not force_refresh and _CACHE_DATA is not None and now < _CACHE_EXPIRY:
            return _CACHE_DATA

        mrr_val, arr_val = cls.calculate_mrr_arr(db)

        # Active & Paused Subscription counts
        active_count = (
            db.query(Subscription)
            .filter(func.lower(Subscription.status) == "active")
            .count()
        )
        paused_count = (
            db.query(Subscription)
            .filter(func.lower(Subscription.status) == "paused")
            .count()
        )
        closed_count = (
            db.query(Subscription)
            .filter(func.lower(Subscription.status) == "closed")
            .count()
        )
        new_count = (
            db.query(Subscription)
            .filter(Subscription.created_at >= datetime.utcnow() - timedelta(days=30))
            .count()
        )

        # Invoices metrics
        invoices = (
            db.query(Invoice)
            .filter(Invoice.status != InvoiceStatus.CANCELLED)
            .all()
        )

        total_invoiced_dec = sum((Decimal(str(inv.total or "0.00")) for inv in invoices), Decimal("0.00"))
        revenue_collected_dec = sum((Decimal(str(inv.amount_paid or "0.00")) for inv in invoices), Decimal("0.00"))
        outstanding_dec = sum((Decimal(str(inv.balance or "0.00")) for inv in invoices if (inv.balance or 0) > 0), Decimal("0.00"))

        # Overdue & Aging
        today_date = date.today()
        overdue_invoices = [
            inv for inv in invoices
            if inv.due_date and inv.due_date < today_date and (inv.balance or 0) > 0
        ]
        overdue_amount_dec = sum((Decimal(str(inv.balance or "0.00")) for inv in overdue_invoices), Decimal("0.00"))

        buckets_map = {
            "0-30 days": {"count": 0, "amount": Decimal("0.00")},
            "31-60 days": {"count": 0, "amount": Decimal("0.00")},
            "61-90 days": {"count": 0, "amount": Decimal("0.00")},
            "90+ days": {"count": 0, "amount": Decimal("0.00")},
        }

        for inv in overdue_invoices:
            diff = (today_date - inv.due_date).days
            amt = Decimal(str(inv.balance or "0.00"))
            if diff <= 30:
                buckets_map["0-30 days"]["count"] += 1
                buckets_map["0-30 days"]["amount"] += amt
            elif diff <= 60:
                buckets_map["31-60 days"]["count"] += 1
                buckets_map["31-60 days"]["amount"] += amt
            elif diff <= 90:
                buckets_map["61-90 days"]["count"] += 1
                buckets_map["61-90 days"]["amount"] += amt
            else:
                buckets_map["90+ days"]["count"] += 1
                buckets_map["90+ days"]["amount"] += amt

        aging_list = [
            AgingBucketSummary(
                bucket=k,
                count=v["count"],
                amount=f"{v['amount']:.2f}",
            )
            for k, v in buckets_map.items()
        ]

        # Payments by Method
        payments = (
            db.query(Payment)
            .filter(Payment.status == PaymentStatus.SUCCESS)
            .all()
        )
        method_map: Dict[str, Dict[str, Any]] = {}
        for p in payments:
            m_str = str(p.payment_method.value if hasattr(p.payment_method, "value") else p.payment_method)
            if m_str not in method_map:
                method_map[m_str] = {"count": 0, "amount": Decimal("0.00")}
            method_map[m_str]["count"] += 1
            method_map[m_str]["amount"] += Decimal(str(p.amount or "0.00"))

        payments_by_method = [
            PaymentsByMethodItem(
                method=k,
                count=v["count"],
                amount=f"{v['amount']:.2f}",
            )
            for k, v in method_map.items()
        ]

        # Revenue trend (last N months)
        trend_items: List[RevenueTrendItem] = []
        for i in range(months - 1, -1, -1):
            m_date = today_date.replace(day=1) - timedelta(days=i * 28)
            label = m_date.strftime("%b %Y")
            trend_items.append(
                RevenueTrendItem(
                    month=label,
                    invoiced=float(total_invoiced_dec) / max(1, months),
                    collected=float(revenue_collected_dec) / max(1, months),
                )
            )

        summary = DashboardSummary(
            currency=settings.DEFAULT_CURRENCY,
            active_subscriptions=active_count,
            paused_subscriptions=paused_count,
            mrr=f"{mrr_val:.2f}",
            arr=f"{arr_val:.2f}",
            revenue_collected=f"{revenue_collected_dec:.2f}",
            total_invoiced=f"{total_invoiced_dec:.2f}",
            outstanding_amount=f"{outstanding_dec:.2f}",
            overdue_invoice_count=len(overdue_invoices),
            overdue_amount=f"{overdue_amount_dec:.2f}",
            new_subscriptions_count=new_count,
            closed_subscriptions_count=closed_count,
            payments_by_method=payments_by_method,
            revenue_trend=trend_items,
            aging_buckets=aging_list,
        )

        _CACHE_DATA = summary
        _CACHE_EXPIRY = now + 180.0  # 3 minutes TTL
        return summary

    @classmethod
    def get_payments_report(cls, db: Session) -> PaymentsReportResponse:
        """Aggregated payments breakdown [PDF 10]."""
        summary = cls.get_dashboard_summary(db)
        return PaymentsReportResponse(
            currency=summary.currency,
            total_collected=summary.revenue_collected,
            by_method=summary.payments_by_method,
        )

    @classmethod
    def get_overdue_report(cls, db: Session) -> OverdueReportResponse:
        """Overdue invoices list and aging brackets [PDF 7.5, 10]."""
        summary = cls.get_dashboard_summary(db)
        invoices = (
            db.query(Invoice)
            .filter(
                Invoice.status != InvoiceStatus.CANCELLED,
                Invoice.balance > 0,
                Invoice.due_date < date.today(),
            )
            .all()
        )
        items = [
            {
                "id": inv.id,
                "number": inv.number,
                "customer_id": inv.customer_id,
                "due_date": str(inv.due_date),
                "total": str(inv.total),
                "balance": str(inv.balance),
                "status": inv.status.value if hasattr(inv.status, "value") else str(inv.status),
            }
            for inv in invoices
        ]
        return OverdueReportResponse(
            currency=summary.currency,
            total_overdue=summary.overdue_amount,
            overdue_count=len(items),
            aging_buckets=summary.aging_buckets,
            items=items,
        )

    @classmethod
    def get_outstanding_report(cls, db: Session) -> OutstandingReportResponse:
        """Unpaid invoices report [PDF 10]."""
        summary = cls.get_dashboard_summary(db)
        invoices = (
            db.query(Invoice)
            .filter(
                Invoice.status != InvoiceStatus.CANCELLED,
                Invoice.balance > 0,
            )
            .all()
        )
        items = [
            {
                "id": inv.id,
                "number": inv.number,
                "customer_id": inv.customer_id,
                "due_date": str(inv.due_date),
                "total": str(inv.total),
                "balance": str(inv.balance),
                "status": inv.status.value if hasattr(inv.status, "value") else str(inv.status),
            }
            for inv in invoices
        ]
        return OutstandingReportResponse(
            currency=summary.currency,
            total_outstanding=summary.outstanding_amount,
            outstanding_count=len(items),
            items=items,
        )

    @classmethod
    def export_active_subscriptions_csv(cls, db: Session) -> str:
        """Exports active subscriptions to formatted CSV string [PDF 8, 10]."""
        subs = (
            db.query(Subscription)
            .filter(func.lower(Subscription.status) == "active")
            .all()
        )
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Subscription Number", "Customer ID", "Plan ID", "Status", "Start Date", "Next Billing Date", "Total Amount", "Currency"])
        for s in subs:
            writer.writerow([
                s.number,
                s.customer_id,
                s.plan_id,
                s.status.value if hasattr(s.status, "value") else str(s.status),
                str(s.start_date),
                str(s.next_billing_date) if s.next_billing_date else "",
                str(s.total_amount),
                s.currency,
            ])
        return output.getvalue()

    @classmethod
    def export_revenue_report_csv(cls, db: Session) -> str:
        """Exports monthly revenue to formatted CSV string [PDF 8, 10]."""
        invoices = db.query(Invoice).filter(Invoice.status != InvoiceStatus.CANCELLED).all()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Period", "Invoice Number", "Customer ID", "Invoiced", "Collected", "Balance", "Currency"])
        for inv in invoices:
            period_str = str(inv.invoice_date.strftime("%Y-%m")) if inv.invoice_date else "Unknown"
            writer.writerow([
                period_str,
                inv.number,
                inv.customer_id,
                str(inv.total),
                str(inv.amount_paid),
                str(inv.balance),
                settings.DEFAULT_CURRENCY,
            ])
        return output.getvalue()
