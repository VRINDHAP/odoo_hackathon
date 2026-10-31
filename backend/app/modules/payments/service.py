"""
Payments Service & Invoice Balance Management [PDF 5.9, 7.2, 8].
Owned by Vrindha.

Implements:
- Atomic payment recording with concurrency protection (`with_for_update`).
- Strict overpayment prevention and status guards.
- Automatic invoice balance updates and transitions to 'paid'.
- Append-only payment reversals with compensatory ledger entries.
- Comprehensive immutable audit logging via `audit_logs`.
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.modules.audit.models import AuditLog
from app.modules.invoices.models import Invoice, InvoiceStatus
from app.modules.payments.exceptions import (
    InvalidInvoiceStatusException,
    OverpaymentException,
    PaymentAlreadyReversedException,
)
from app.modules.payments.models import Payment, PaymentMethod, PaymentStatus
from app.modules.payments.schemas import PaymentCreate, PaymentReversalCreate

logger = logging.getLogger(__name__)


def _log_payment_audit(
    db: Session,
    actor_id: Optional[str],
    action: str,
    invoice_id: str,
    before: dict,
    after: dict,
) -> None:
    """Record an immutable audit log entry."""
    try:
        audit_entry = AuditLog(
            id=str(uuid.uuid4()),
            actor_id=str(actor_id) if actor_id else None,
            entity="invoices",
            entity_id=str(invoice_id),
            action=action,
            before_json=before,
            after_json=after,
            at=datetime.utcnow(),
        )
        db.add(audit_entry)
    except Exception as exc:
        logger.warning(f"Could not persist audit log to DB: {exc}")


class PaymentService:
    """
    Service layer executing financial settlements and balance recalculations [PDF 5.9, 7.2, 8].
    """

    @staticmethod
    def record_payment(
        payment_in: PaymentCreate,
        actor_user: Optional[Any],
        db: Session,
        invoice_id: Optional[str] = None,
    ) -> Payment:
        """
        Record a payment settlement against an invoice.
        Enforces status guards, overpayment boundaries, updates balances, and logs audits.
        """
        effective_invoice_id = str(invoice_id or payment_in.invoice_id)
        if not effective_invoice_id or effective_invoice_id == "None":
            raise NotFoundError("Invoice", "None")

        actor_id = str(actor_user.id) if actor_user and hasattr(actor_user, "id") else None

        with db.begin_nested():
            # Concurrency row-locking for PostgreSQL
            query = db.query(Invoice).filter(Invoice.id == effective_invoice_id)
            if db.get_bind().dialect.name == "postgresql":
                query = query.with_for_update()
            invoice = query.first()

            if not invoice:
                raise NotFoundError("Invoice", effective_invoice_id)

            # Guard 1: Invoice status check (cannot pay draft or cancelled invoices)
            raw_status = invoice.status.value if hasattr(invoice.status, "value") else str(invoice.status)
            if raw_status.lower() in ("draft", "cancelled"):
                raise InvalidInvoiceStatusException(
                    f"Cannot record payment for invoice '{invoice.number}' in '{raw_status}' status. "
                    "Invoice must be confirmed."
                )

            # Guard 2: Amount must be strictly greater than 0
            amount = Decimal(str(payment_in.amount)).quantize(Decimal("0.01"))
            if amount <= Decimal("0.00"):
                raise OverpaymentException("Payment amount must be strictly greater than zero.")

            # Guard 3: Overpayment check (amount <= balance)
            if amount > invoice.balance:
                raise OverpaymentException(
                    f"Payment amount ({amount}) exceeds remaining unpaid balance ({invoice.balance})."
                )

            # Create payment entity
            payment = Payment(
                id=str(uuid.uuid4()),
                invoice_id=invoice.id,
                method=payment_in.method,
                amount=amount,
                payment_date=datetime.utcnow(),
                reference=payment_in.reference,
                note=payment_in.note,
                recorded_by=actor_id,
                status=PaymentStatus.SUCCESS,
            )
            db.add(payment)

            # Capture pre-state for audit
            before_state = {
                "amount_paid": str(invoice.amount_paid),
                "balance": str(invoice.balance),
                "status": raw_status,
            }

            # Recalculate invoice totals
            invoice.amount_paid = (invoice.amount_paid + amount).quantize(Decimal("0.01"))
            invoice.balance = max(Decimal("0.00"), invoice.total - invoice.amount_paid).quantize(Decimal("0.01"))

            # Transition invoice state if fully settled
            if invoice.balance <= Decimal("0.00"):
                invoice.status = InvoiceStatus.PAID

            invoice.updated_at = datetime.utcnow()

            # Record audit entry
            after_state = {
                "amount_paid": str(invoice.amount_paid),
                "balance": str(invoice.balance),
                "status": invoice.status.value if hasattr(invoice.status, "value") else str(invoice.status),
                "payment_id": payment.id,
                "payment_amount": str(amount),
                "payment_method": payment.method.value if hasattr(payment.method, "value") else str(payment.method),
            }
            _log_payment_audit(db, actor_id, "RECORD_PAYMENT", invoice.id, before_state, after_state)

        db.commit()
        db.refresh(payment)
        return payment

    @staticmethod
    def reverse_payment(
        payment_id: str,
        reversal_in: PaymentReversalCreate,
        actor_user: Optional[Any],
        db: Session,
    ) -> Payment:
        """
        Execute an append-only reversal of a previously settled payment.
        Creates a compensatory ledger entry, restores invoice balance, and audits the reason.
        """
        actor_id = str(actor_user.id) if actor_user and hasattr(actor_user, "id") else None

        with db.begin_nested():
            payment = db.query(Payment).filter(Payment.id == str(payment_id)).first()
            if not payment:
                raise NotFoundError("Payment", payment_id)

            if payment.status != PaymentStatus.SUCCESS:
                raise PaymentAlreadyReversedException(
                    f"Payment '{payment_id}' is in status '{payment.status.value}' and cannot be reversed."
                )

            # Lock the related invoice
            query = db.query(Invoice).filter(Invoice.id == payment.invoice_id)
            if db.get_bind().dialect.name == "postgresql":
                query = query.with_for_update()
            invoice = query.first()

            if not invoice:
                raise NotFoundError("Invoice", payment.invoice_id)

            # Mark original payment as reversed
            payment.status = PaymentStatus.REVERSED
            payment.reversal_reason = reversal_in.reason
            payment.updated_at = datetime.utcnow()

            # Append-only reversal: create compensatory negative payment entry
            reversal_note = f"Reversal of {payment.id}: {reversal_in.reason}"
            if reversal_in.note:
                reversal_note += f" - {reversal_in.note}"

            compensatory_payment = Payment(
                id=str(uuid.uuid4()),
                invoice_id=invoice.id,
                method=payment.method,
                amount=(-payment.amount).quantize(Decimal("0.01")),
                payment_date=datetime.utcnow(),
                reference=f"REV-{payment.id[:8]}",
                note=reversal_note,
                recorded_by=actor_id,
                status=PaymentStatus.REVERSED,
                reversal_reason=reversal_in.reason,
                reversed_payment_id=payment.id,
            )
            db.add(compensatory_payment)

            # Track pre-state for audit
            before_state = {
                "amount_paid": str(invoice.amount_paid),
                "balance": str(invoice.balance),
                "status": invoice.status.value if hasattr(invoice.status, "value") else str(invoice.status),
            }

            # Restore balance and amount_paid
            invoice.amount_paid = max(Decimal("0.00"), invoice.amount_paid - payment.amount).quantize(Decimal("0.01"))
            invoice.balance = (invoice.total - invoice.amount_paid).quantize(Decimal("0.01"))

            # If invoice was marked paid, revert back to confirmed
            raw_status = invoice.status.value if hasattr(invoice.status, "value") else str(invoice.status)
            if invoice.balance > Decimal("0.00") and raw_status.lower() == "paid":
                invoice.status = InvoiceStatus.CONFIRMED

            invoice.updated_at = datetime.utcnow()

            # Log audit
            after_state = {
                "amount_paid": str(invoice.amount_paid),
                "balance": str(invoice.balance),
                "status": invoice.status.value if hasattr(invoice.status, "value") else str(invoice.status),
                "reversed_payment_id": payment.id,
                "reversal_reason": reversal_in.reason,
            }
            _log_payment_audit(db, actor_id, "REVERSE_PAYMENT", invoice.id, before_state, after_state)

        db.commit()
        db.refresh(payment)
        return payment

    @staticmethod
    def list_payments(
        invoice_id: Optional[str] = None,
        method: Optional[PaymentMethod] = None,
        status: Optional[PaymentStatus] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        skip: int = 0,
        limit: int = 20,
        db: Session = None,
    ) -> Tuple[List[Payment], int]:
        """Query payments with filtering and pagination."""
        query = db.query(Payment)

        if invoice_id:
            query = query.filter(Payment.invoice_id == str(invoice_id))
        if method:
            query = query.filter(Payment.method == method)
        if status:
            query = query.filter(Payment.status == status)
        if start_date:
            query = query.filter(Payment.payment_date >= datetime.combine(start_date, datetime.min.time()))
        if end_date:
            query = query.filter(Payment.payment_date <= datetime.combine(end_date, datetime.max.time()))

        total = query.count()
        items = query.order_by(Payment.created_at.desc()).offset(skip).limit(limit).all()
        return items, total

