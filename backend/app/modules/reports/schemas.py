"""
Pydantic Schemas for Reports and Executive Financial Summaries [PDF 10, 11].
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class AgingBucketSummary(BaseModel):
    """Aging bracket summary representation [PDF 7.5, 10]."""
    bucket: str = Field(..., description="Aging bucket label: 0-30 days, 31-60 days, etc.")
    count: int = Field(0, description="Number of overdue invoices in bucket")
    amount: str = Field("0.00", description="Total overdue balance in bucket")


class PaymentsByMethodItem(BaseModel):
    """Payment breakdown by method."""
    method: str
    amount: str
    count: int


class RevenueTrendItem(BaseModel):
    """Monthly revenue trend data point."""
    month: str
    invoiced: float
    collected: float


class DashboardSummary(BaseModel):
    """
    Executive Summary KPI mosaic [PDF 10, 11].
    Provides normalized MRR, ARR, and real-time revenue collection metrics.
    """
    currency: str = "INR"
    active_subscriptions: int = 0
    paused_subscriptions: int = 0
    mrr: str = "0.00"
    arr: str = "0.00"
    revenue_collected: str = "0.00"
    total_invoiced: str = "0.00"
    outstanding_amount: str = "0.00"
    overdue_invoice_count: int = 0
    overdue_amount: str = "0.00"
    new_subscriptions_count: int = 0
    closed_subscriptions_count: int = 0
    payments_by_method: List[PaymentsByMethodItem] = []
    revenue_trend: List[RevenueTrendItem] = []
    aging_buckets: List[AgingBucketSummary] = []

    model_config = ConfigDict(from_attributes=True)


class PaymentsReportResponse(BaseModel):
    """Payment collections aggregated report [PDF 10]."""
    currency: str = "INR"
    total_collected: str = "0.00"
    by_method: List[PaymentsByMethodItem] = []


class OverdueReportResponse(BaseModel):
    """Overdue invoices report with aging analysis [PDF 7.5, 10]."""
    currency: str = "INR"
    total_overdue: str = "0.00"
    overdue_count: int = 0
    aging_buckets: List[AgingBucketSummary] = []
    items: List[Dict[str, Any]] = []


class OutstandingReportResponse(BaseModel):
    """Unpaid invoices report [PDF 10]."""
    currency: str = "INR"
    total_outstanding: str = "0.00"
    outstanding_count: int = 0
    items: List[Dict[str, Any]] = []


class RevenueReportRow(BaseModel):
    """Revenue breakdown row by period, plan, and product."""
    period: str
    plan_name: str
    product_name: str
    invoiced: str
    collected: str
    currency: str = "INR"
