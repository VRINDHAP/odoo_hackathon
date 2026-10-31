"""
Internal Domain Contracts between Nandana's and Vrindha's Modules.
Established in backend/INTERFACES.md Section 2 to guarantee zero circular imports,
clear boundaries, and independent module testability.
"""
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional, Protocol, Dict, Any
from uuid import UUID


# ================= TAX CONTRACTS =================
@dataclass(frozen=True)
class TaxBreakdown:
    tax_id: Optional[str]
    rate: Decimal
    inclusive: bool
    tax_amount: Decimal
    taxable_amount: Decimal


class TaxCalculationProtocol(Protocol):
    """Exposed by Nandana (taxes) -> Consumed by Vrindha (invoices) [PDF 7.1]."""

    def calculate(self, tax_id: Optional[str], taxable_amount: Decimal) -> TaxBreakdown:
        ...


# ================= DISCOUNT CONTRACTS =================
@dataclass(frozen=True)
class LineItemSnapshot:
    product_id: str
    quantity: int
    unit_price: Decimal
    subtotal: Decimal


@dataclass(frozen=True)
class DiscountApplication:
    discount_id: str
    name: str
    discount_amount: Decimal
    scope: str  # 'product' or 'subscription'


class DiscountEngineProtocol(Protocol):
    """Exposed by Nandana (discounts) -> Consumed by Vrindha (billing engine) [PDF 7.3]."""

    def evaluate_and_apply(
        self,
        subtotal: Decimal,
        lines: List[LineItemSnapshot],
        customer_id: str,
        invoice_date: date,
    ) -> Optional[DiscountApplication]:
        ...

    def increment_usage(self, discount_id: str) -> bool:
        ...

    def release_usage(self, discount_id: str) -> None:
        ...


# ================= AUDIT CONTRACTS =================
@dataclass(frozen=True)
class AuditEvent:
    actor_id: Optional[str]
    entity: str
    entity_id: str
    action: str
    before_json: Optional[Dict[str, Any]]
    after_json: Optional[Dict[str, Any]]
    ip: Optional[str]
    timestamp: datetime = field(default_factory=datetime.utcnow)


class AuditServiceProtocol(Protocol):
    """Exposed by Nandana (audit) -> Consumed across all modules [PDF 5.10, 9]."""

    def record(
        self,
        actor_id: Optional[str],
        entity: str,
        entity_id: str,
        action: str,
        before_json: Optional[Dict[str, Any]] = None,
        after_json: Optional[Dict[str, Any]] = None,
        ip: Optional[str] = None,
    ) -> None:
        ...
