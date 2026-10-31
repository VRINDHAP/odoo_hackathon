"""
Pytest Suite for Payments Engine & Balance Management [PDF 5.9, 7.4, 8].
Owned by Vrindha.
"""
import uuid
from datetime import date, datetime
from decimal import Decimal
import pytest

from app.modules.invoices.models import Invoice, InvoiceStatus
from app.modules.payments.exceptions import (
    InvalidInvoiceStatusException,
    OverpaymentException,
    PaymentAlreadyReversedException,
)
from app.modules.payments.models import Payment, PaymentMethod, PaymentStatus
from app.modules.payments.schemas import PaymentCreate, PaymentReversalCreate
from app.modules.payments.service import PaymentService


def _create_test_invoice(db_session, customer_id, total=Decimal("1000.00"), status=InvoiceStatus.CONFIRMED):
    inv = Invoice(
        id=str(uuid.uuid4()),
        number=f"INV-{uuid.uuid4().hex[:6].upper()}",
        customer_id=customer_id,
        status=status,
        invoice_date=date.today(),
        due_date=date.today(),
        period_start=date(2026, 1, 1),
        period_end=date(2026, 2, 1),
        subtotal=total,
        total=total,
        amount_paid=Decimal("0.00"),
        balance=total,
    )
    db_session.add(inv)
    db_session.commit()
    db_session.refresh(inv)
    return inv


def test_partial_payment_decrements_balance(db_session, admin_user):
    """Partial payment decrements balance and updates amount_paid."""
    invoice = _create_test_invoice(db_session, admin_user.id, Decimal("1000.00"))

    payload = PaymentCreate(
        invoice_id=invoice.id,
        method=PaymentMethod.CARD,
        amount=Decimal("350.00"),
        reference="CARD-TXN-01",
    )
    payment = PaymentService.record_payment(payload, admin_user, db_session)

    assert payment.status == PaymentStatus.SUCCESS
    assert payment.amount == Decimal("350.00")

    db_session.refresh(invoice)
    assert invoice.amount_paid == Decimal("350.00")
    assert invoice.balance == Decimal("650.00")
    assert invoice.status == InvoiceStatus.CONFIRMED


def test_full_payment_transitions_invoice_to_paid(db_session, admin_user):
    """Full settlement automatically marks invoice as 'paid'."""
    invoice = _create_test_invoice(db_session, admin_user.id, Decimal("500.00"))

    payload = PaymentCreate(
        invoice_id=invoice.id,
        method=PaymentMethod.UPI,
        amount=Decimal("500.00"),
        reference="UPI-REF-01",
    )
    payment = PaymentService.record_payment(payload, admin_user, db_session)

    assert payment.status == PaymentStatus.SUCCESS
    db_session.refresh(invoice)
    assert invoice.amount_paid == Decimal("500.00")
    assert invoice.balance == Decimal("0.00")
    assert invoice.status == InvoiceStatus.PAID


def test_overpayment_rejected_with_400(db_session, admin_user):
    """Overpayment exceeding remaining invoice balance is blocked."""
    invoice = _create_test_invoice(db_session, admin_user.id, Decimal("100.00"))

    payload = PaymentCreate(
        invoice_id=invoice.id,
        method=PaymentMethod.BANK_TRANSFER,
        amount=Decimal("100.01"),
    )
    with pytest.raises(OverpaymentException):
        PaymentService.record_payment(payload, admin_user, db_session)

    db_session.refresh(invoice)
    assert invoice.balance == Decimal("100.00")
    assert invoice.amount_paid == Decimal("0.00")


def test_payment_reversal_append_only(db_session, admin_user):
    """Reversing a payment appends a compensatory ledger entry and restores balance."""
    invoice = _create_test_invoice(db_session, admin_user.id, Decimal("400.00"))

    # Pay full
    payment = PaymentService.record_payment(
        PaymentCreate(invoice_id=invoice.id, method=PaymentMethod.CARD, amount=Decimal("400.00")),
        admin_user,
        db_session,
    )
    db_session.refresh(invoice)
    assert invoice.status == InvoiceStatus.PAID

    # Reverse payment
    reversal_in = PaymentReversalCreate(reason="Fraud chargeback", note="Bank return issued")
    reversed_payment = PaymentService.reverse_payment(payment.id, reversal_in, admin_user, db_session)

    assert reversed_payment.status == PaymentStatus.REVERSED
    assert reversed_payment.reversal_reason == "Fraud chargeback"

    # Verify compensatory entry
    compensatory = db_session.query(Payment).filter(Payment.reversed_payment_id == payment.id).first()
    assert compensatory is not None
    assert compensatory.amount == Decimal("-400.00")

    # Verify invoice status reverted to confirmed
    db_session.refresh(invoice)
    assert invoice.balance == Decimal("400.00")
    assert invoice.amount_paid == Decimal("0.00")
    assert invoice.status == InvoiceStatus.CONFIRMED

    # Prevent duplicate reversal
    with pytest.raises(PaymentAlreadyReversedException):
        PaymentService.reverse_payment(payment.id, reversal_in, admin_user, db_session)

