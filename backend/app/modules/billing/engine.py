"""
Automated Recurring Billing Engine [PDF 1, 5.9, 5.10, 7.2].
Owned by Vrindha.

Implements:
- Daily batch worker execution (`run_billing`) generating invoices programmatically.
- Zero Double Billing: Database constraints + per-subscription isolated savepoints.
- Worker Concurrency: Row-level locking via `with_for_update(skip_locked=True)` in PostgreSQL.
- Discount Integration: Automatically evaluates and atomically redeems best discount rule.
- Comprehensive Error Isolation: Failed subscriptions rollback individually without halting the batch run.
- Subscription date progression & auto-closure at expiration.
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional
import sys

from sqlalchemy import func, text
from sqlalchemy.orm import Session, selectinload

from app.modules.billing.models import BillingRun
from app.modules.discounts.service import DiscountService
from app.modules.invoices.models import Invoice, InvoiceLine, InvoiceStatus
from app.modules.subscriptions.models import Subscription, SubscriptionStatus
from app.modules.subscriptions.service import get_plan_policy
from app.modules.taxes.service import TaxService
from app.modules.subscriptions.utils import (
    calculate_billing_period_range,
    calculate_next_billing_date,
    generate_subscription_number,
)

logger = logging.getLogger(__name__)


def generate_invoice_number(db: Session, prefix: str = "INV") -> str:
    """Generates unique formatted sequence invoice number, e.g. INV-2026-000001 [PDF 5.9]."""
    count = db.query(func.count(Invoice.id)).scalar() or 0
    seq = count + 1
    year = datetime.utcnow().year
    return f"{prefix}-{year}-{seq:06d}"


def round_half_up(value: Decimal, places: int = 2) -> Decimal:
    """Rounds financial decimal values half-up to specified places."""
    quantizer = Decimal(10) ** -places
    return value.quantize(quantizer, rounding=ROUND_HALF_UP)


class BillingEngine:
    """
    Automated Billing Engine Core Service [PDF 7.2].
    """

    @classmethod
    def run_billing(
        cls,
        target_date: Optional[date] = None,
        batch_size: int = 100,
        db: Session = None,
    ) -> BillingRun:
        """
        Executes recurring billing run for all active subscriptions due on or before `target_date`.

        Guarantees:
        - No manual invoicing: Every invoice is generated directly from contracted subscription lines.
        - Zero double billing: Idempotency check + UNIQUE(subscription_id, period_start, period_end).
        - Worker concurrency: SKIP LOCKED prevents duplicate execution across multiple workers.
        - Atomic discount redemption and line snapshotting.
        - Error isolation: Single subscription exception rolls back its savepoint and records diagnostic.
        """
        if db is None:
            raise ValueError("Database session 'db' is required for billing run.")

        today = target_date or date.today()

        billing_run = BillingRun(
            id=str(uuid.uuid4()),
            run_date=today,
            started_at=datetime.utcnow(),
            created_count=0,
            skipped_count=0,
            failed_count=0,
            error_summary=[],
        )
        db.add(billing_run)
        db.commit()
        db.refresh(billing_run)

        # 1. Scan for eligible active subscriptions due for billing (eager loading lines) [PDF 5.11, 7.2]
        query = (
            db.query(Subscription)
            .options(selectinload(Subscription.lines))
            .filter(
                Subscription.status == SubscriptionStatus.ACTIVE,
                Subscription.next_billing_date <= today,
            )
            .order_by(Subscription.id)
        )

        # Use SKIP LOCKED concurrency if PostgreSQL dialect is active [PDF 7.2]
        bind_engine = db.get_bind()
        if bind_engine and bind_engine.dialect.name == "postgresql":
            query = query.with_for_update(skip_locked=True)

        due_subscriptions = query.limit(batch_size).all()
        logger.info(
            f"Billing run '{billing_run.id}' targeting {today}: found {len(due_subscriptions)} due subscriptions."
        )

        errors: List[Dict[str, str]] = []

        # 2. Process each subscription inside an isolated savepoint [PDF 7.2]
        for sub in due_subscriptions:
            try:
                with db.begin_nested():
                    plan_policy = get_plan_policy(db, sub.plan_id)
                    period_start = sub.next_billing_date

                    # Determine period_end stabilized with anchor_day [PDF 7.2]
                    period_end = calculate_next_billing_date(
                        current_date=period_start,
                        billing_period=plan_policy.billing_period,
                        anchor_day=sub.anchor_day,
                    )

                    # 3. Idempotency Check: Guard against duplicate run for this exact period [PDF 1, 7.2]
                    existing_invoice = (
                        db.query(Invoice)
                        .filter(
                            Invoice.subscription_id == sub.id,
                            Invoice.period_start == period_start,
                            Invoice.period_end == period_end,
                        )
                        .first()
                    )
                    if existing_invoice:
                        logger.debug(
                            f"Subscription '{sub.id}' already billed for period {period_start} to {period_end}. Skipping."
                        )
                        billing_run.skipped_count += 1
                        continue

                    # 4. Initialize Invoice
                    invoice_id = str(uuid.uuid4())
                    inv_number = generate_invoice_number(db)
                    due_date = period_start + timedelta(days=15)  # Standard Net 15 fallback

                    invoice = Invoice(
                        id=invoice_id,
                        number=inv_number,
                        subscription_id=sub.id,
                        customer_id=sub.customer_id,
                        status=InvoiceStatus.CONFIRMED,
                        invoice_date=today,
                        due_date=due_date,
                        period_start=period_start,
                        period_end=period_end,
                        subtotal=Decimal("0.00"),
                        discount_total=Decimal("0.00"),
                        tax_total=Decimal("0.00"),
                        total=Decimal("0.00"),
                        amount_paid=Decimal("0.00"),
                        balance=Decimal("0.00"),
                    )

                    # 5. Build Invoice Line Items from contracted subscription lines
                    subtotal = Decimal("0.00")
                    tax_total = Decimal("0.00")
                    line_items: List[InvoiceLine] = []

                    for sub_line in sub.lines:
                        qty = Decimal(str(sub_line.quantity))
                        unit_p = Decimal(str(sub_line.unit_price))
                        line_sub = round_half_up(qty * unit_p, 2)

                        # Compute line-level tax snapshot using Nandana's TaxService [PDF 5.7, 7.1]
                        if sub_line.tax_id:
                            try:
                                tax_res = TaxService.calculate_tax(db=db, tax_id=sub_line.tax_id, amount=line_sub)
                                line_tax = tax_res.tax_amount
                                line_subtotal = tax_res.taxable_amount
                                line_total = tax_res.total_amount
                            except Exception:
                                tax_pct = Decimal(str(sub_line.tax_rate)) if sub_line.tax_rate else Decimal("0.00")
                                line_tax = round_half_up(line_sub * (tax_pct / Decimal("100.0")), 2)
                                line_subtotal = line_sub
                                line_total = line_sub + line_tax
                        else:
                            tax_pct = Decimal(str(sub_line.tax_rate)) if sub_line.tax_rate else Decimal("0.00")
                            line_tax = round_half_up(line_sub * (tax_pct / Decimal("100.0")), 2)
                            line_subtotal = line_sub
                            line_total = line_sub + line_tax

                        subtotal += line_subtotal
                        tax_total += line_tax

                        inv_line = InvoiceLine(
                            id=str(uuid.uuid4()),
                            invoice_id=invoice_id,
                            product_id=sub_line.product_id,
                            description=sub_line.description or f"Subscription recurring charge",
                            quantity=sub_line.quantity,
                            unit_price=unit_p,
                            discount_amount=Decimal("0.00"),
                            tax_id=sub_line.tax_id,
                            tax_amount=line_tax,
                            line_total=line_total,
                        )
                        line_items.append(inv_line)

                    # 6. Evaluate and Apply Discounts automatically [PDF 7.1, 7.3]
                    discount_total = Decimal("0.00")
                    discount_eval = DiscountService.evaluate_discount(
                        subtotal=subtotal,
                        lines=sub.lines,
                        invoice_date=period_start,
                        db=db,
                    )
                    if discount_eval:
                        matched_rule, discount_amount = discount_eval
                        discount_total = discount_amount

                        # Atomically redeem discount to prevent concurrent cap violations [PDF 7.3]
                        redeemed = DiscountService.redeem_discount_atomic(
                            discount_id=matched_rule.id,
                            invoice_id=invoice_id,
                            subscription_id=sub.id,
                            amount=discount_total,
                            db=db,
                        )
                        if not redeemed:
                            discount_total = Decimal("0.00")

                    # 7. Calculate Net Totals
                    net_total = round_half_up(max(Decimal("0.00"), (subtotal - discount_total) + tax_total), 2)
                    invoice.subtotal = round_half_up(subtotal, 2)
                    invoice.discount_total = round_half_up(discount_total, 2)
                    invoice.tax_total = round_half_up(tax_total, 2)
                    invoice.total = net_total
                    invoice.balance = net_total
                    invoice.lines = line_items

                    db.add(invoice)
                    db.flush()

                    # 8. Advance Subscription Billing Dates
                    sub.last_billed_through = period_end
                    sub.next_billing_date = period_end

                    # 9. Handle Expiry and Auto-Close [PDF 5.4, 7.2]
                    if sub.end_date and sub.end_date <= period_end:
                        if plan_policy.auto_close:
                            sub.status = SubscriptionStatus.CLOSED
                            sub.closed_at = datetime.utcnow()
                            sub.close_reason = "Plan expired (auto-close)"

                    billing_run.created_count += 1

            except Exception as exc:
                # Isolated exception handling: savepoint rolls back only this subscription
                logger.error(f"Error processing subscription '{sub.id}' in billing run: {exc}", exc_info=True)
                billing_run.failed_count += 1
                errors.append({"subscription_id": sub.id, "error": str(exc)})

        # 10. Finalize billing run record
        billing_run.finished_at = datetime.utcnow()
        billing_run.error_summary = errors if errors else None
        db.commit()
        db.refresh(billing_run)

        logger.info(
            f"Billing run '{billing_run.id}' completed: "
            f"created={billing_run.created_count}, skipped={billing_run.skipped_count}, failed={billing_run.failed_count}."
        )
        return billing_run


# Convenience functional alias matching the prompt specification
run_billing = BillingEngine.run_billing

