"""
Unit & Integration Tests for Step 5: Payments Engine & Invoice Balance Management [PDF 5.9, 7.2, 8].
Owned by Vrindha.
"""
from __future__ import annotations

import unittest
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.core.errors import ForbiddenError, NotFoundError
from app.modules.auth.models import User, UserRole
from app.modules.audit.models import AuditLog
from app.modules.invoices.models import Invoice, InvoiceLine, InvoiceStatus
from app.modules.payments.exceptions import (
    InvalidInvoiceStatusException,
    OverpaymentException,
    PaymentAlreadyReversedException,
)
from app.modules.payments.models import Payment, PaymentMethod, PaymentStatus
from app.modules.payments.schemas import PaymentCreate, PaymentReversalCreate
from app.modules.payments.service import PaymentService
from app.modules.payments.router import (
    customer_pay_invoice,
    list_payments,
    record_invoice_payment,
    reverse_payment,
)


class TestPaymentsStep5(unittest.TestCase):
    """Test suite verifying Step 5 payment settlement, overpayment guards, reversals, and RBAC."""

    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine("sqlite:///:memory:", echo=False)
        Base.metadata.create_all(bind=cls.engine)
        cls.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)

    def setUp(self):
        self.db = self.SessionLocal()
        # Clean test tables
        self.db.query(Payment).delete()
        self.db.query(InvoiceLine).delete()
        self.db.query(Invoice).delete()
        self.db.query(AuditLog).delete()
        self.db.query(User).delete()
        self.db.commit()

        # Create test users
        self.admin = User(
            id=str(uuid.uuid4()),
            email="admin_pay@brightloop.io",
            password_hash="fakehash",
            role=UserRole.ADMIN,
            is_active=True,
        )
        self.staff = User(
            id=str(uuid.uuid4()),
            email="staff_pay@brightloop.io",
            password_hash="fakehash",
            role=UserRole.STAFF,
            is_active=True,
        )
        self.customer1_id = str(uuid.uuid4())
        self.customer2_id = str(uuid.uuid4())
        self.cust_user1 = User(
            id=str(uuid.uuid4()),
            email="cust1@brightloop.io",
            password_hash="fakehash",
            role=UserRole.CUSTOMER,
            customer_id=self.customer1_id,
            is_active=True,
        )
        self.cust_user2 = User(
            id=str(uuid.uuid4()),
            email="cust2@brightloop.io",
            password_hash="fakehash",
            role=UserRole.CUSTOMER,
            customer_id=self.customer2_id,
            is_active=True,
        )
        self.db.add_all([self.admin, self.staff, self.cust_user1, self.cust_user2])
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def _create_invoice(
        self,
        customer_id: str,
        total: Decimal = Decimal("1000.00"),
        status: InvoiceStatus = InvoiceStatus.CONFIRMED,
    ) -> Invoice:
        invoice = Invoice(
            id=str(uuid.uuid4()),
            number=f"INV-{uuid.uuid4().hex[:6].upper()}",
            customer_id=customer_id,
            status=status,
            invoice_date=date.today(),
            due_date=date.today(),
            period_start=date(2026, 1, 1),
            period_end=date(2026, 2, 1),
            subtotal=total,
            discount_total=Decimal("0.00"),
            tax_total=Decimal("0.00"),
            total=total,
            amount_paid=Decimal("0.00"),
            balance=total,
        )
        self.db.add(invoice)
        self.db.commit()
        self.db.refresh(invoice)
        return invoice

    def test_record_partial_payment(self):
        """Record partial payment against confirmed invoice and verify balance decrement."""
        invoice = self._create_invoice(self.customer1_id, Decimal("1000.00"))

        payload = PaymentCreate(
            invoice_id=invoice.id,
            method=PaymentMethod.CARD,
            amount=Decimal("400.00"),
            reference="TXN-400-01",
            note="Partial payment 1",
        )
        payment = PaymentService.record_payment(payload, self.staff, self.db)

        self.assertEqual(payment.status, PaymentStatus.SUCCESS)
        self.assertEqual(payment.amount, Decimal("400.00"))
        self.assertEqual(payment.recorded_by, self.staff.id)

        # Verify invoice balance
        self.db.refresh(invoice)
        self.assertEqual(invoice.amount_paid, Decimal("400.00"))
        self.assertEqual(invoice.balance, Decimal("600.00"))
        self.assertEqual(invoice.status, InvoiceStatus.CONFIRMED)

        # Verify audit log
        audit = self.db.query(AuditLog).filter(
            AuditLog.entity == "invoices",
            AuditLog.entity_id == invoice.id,
            AuditLog.action == "RECORD_PAYMENT",
        ).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.after_json["balance"], "600.00")

    def test_record_full_payment_transitions_to_paid(self):
        """Full payment transitions invoice status to 'paid'."""
        invoice = self._create_invoice(self.customer1_id, Decimal("500.00"))

        payload = PaymentCreate(
            invoice_id=invoice.id,
            method=PaymentMethod.UPI,
            amount=Decimal("500.00"),
            reference="UPI-REF-999",
        )
        payment = PaymentService.record_payment(payload, self.admin, self.db)

        self.assertEqual(payment.status, PaymentStatus.SUCCESS)
        self.db.refresh(invoice)
        self.assertEqual(invoice.amount_paid, Decimal("500.00"))
        self.assertEqual(invoice.balance, Decimal("0.00"))
        self.assertEqual(invoice.status, InvoiceStatus.PAID)

    def test_overpayment_blocked(self):
        """Payment amount exceeding balance is strictly rejected with OverpaymentException."""
        invoice = self._create_invoice(self.customer1_id, Decimal("200.00"))

        payload = PaymentCreate(
            invoice_id=invoice.id,
            method=PaymentMethod.BANK_TRANSFER,
            amount=Decimal("250.00"),
        )
        with self.assertRaises(OverpaymentException):
            PaymentService.record_payment(payload, self.staff, self.db)

        self.db.refresh(invoice)
        self.assertEqual(invoice.balance, Decimal("200.00"))
        self.assertEqual(invoice.amount_paid, Decimal("0.00"))

    def test_draft_or_cancelled_invoice_payment_blocked(self):
        """Cannot record payment against draft or cancelled invoices."""
        draft_inv = self._create_invoice(self.customer1_id, Decimal("100.00"), status=InvoiceStatus.DRAFT)
        payload = PaymentCreate(invoice_id=draft_inv.id, method=PaymentMethod.CASH, amount=Decimal("50.00"))
        with self.assertRaises(InvalidInvoiceStatusException):
            PaymentService.record_payment(payload, self.admin, self.db)

        cancelled_inv = self._create_invoice(self.customer1_id, Decimal("100.00"), status=InvoiceStatus.CANCELLED)
        payload2 = PaymentCreate(invoice_id=cancelled_inv.id, method=PaymentMethod.CASH, amount=Decimal("50.00"))
        with self.assertRaises(InvalidInvoiceStatusException):
            PaymentService.record_payment(payload2, self.admin, self.db)

    def test_payment_reversal_append_only(self):
        """Append-only payment reversal restores invoice balance and creates compensatory record."""
        invoice = self._create_invoice(self.customer1_id, Decimal("300.00"))

        # Pay in full
        pay_payload = PaymentCreate(invoice_id=invoice.id, method=PaymentMethod.CARD, amount=Decimal("300.00"))
        payment = PaymentService.record_payment(pay_payload, self.admin, self.db)
        self.db.refresh(invoice)
        self.assertEqual(invoice.status, InvoiceStatus.PAID)
        self.assertEqual(invoice.balance, Decimal("0.00"))

        # Reverse payment
        rev_payload = PaymentReversalCreate(reason="Chargeback dispute #1234", note="Customer requested bank return")
        reversed_p = PaymentService.reverse_payment(payment.id, rev_payload, self.admin, self.db)

        self.assertEqual(reversed_p.status, PaymentStatus.REVERSED)
        self.assertEqual(reversed_p.reversal_reason, "Chargeback dispute #1234")

        # Verify compensatory entry exists
        compensatory = self.db.query(Payment).filter(
            Payment.reversed_payment_id == payment.id,
        ).first()
        self.assertIsNotNone(compensatory)
        self.assertEqual(compensatory.amount, Decimal("-300.00"))
        self.assertEqual(compensatory.status, PaymentStatus.REVERSED)

        # Verify invoice is reverted to confirmed with original balance
        self.db.refresh(invoice)
        self.assertEqual(invoice.amount_paid, Decimal("0.00"))
        self.assertEqual(invoice.balance, Decimal("300.00"))
        self.assertEqual(invoice.status, InvoiceStatus.CONFIRMED)

        # Attempt duplicate reversal
        with self.assertRaises(PaymentAlreadyReversedException):
            PaymentService.reverse_payment(payment.id, rev_payload, self.admin, self.db)

    def test_customer_portal_isolation(self):
        """Customers can pay their own invoices, but are forbidden from paying other customers' invoices."""
        inv_cust1 = self._create_invoice(self.customer1_id, Decimal("150.00"))

        # Customer 2 attempts to pay Customer 1's invoice -> HTTP 403 Forbidden
        pay_in = PaymentCreate(method=PaymentMethod.CARD, amount=Decimal("150.00"))
        with self.assertRaises(ForbiddenError):
            customer_pay_invoice(id=inv_cust1.id, payment_in=pay_in, db=self.db, current_user=self.cust_user2)

        # Customer 1 pays their own invoice -> Success
        res = customer_pay_invoice(id=inv_cust1.id, payment_in=pay_in, db=self.db, current_user=self.cust_user1)
        self.assertEqual(res.status, PaymentStatus.SUCCESS)
        self.assertEqual(res.amount, Decimal("150.00"))

        self.db.refresh(inv_cust1)
        self.assertEqual(inv_cust1.status, InvoiceStatus.PAID)
        self.assertEqual(inv_cust1.balance, Decimal("0.00"))

    def test_list_payments_query(self):
        """Test listing payments with method and status filtering."""
        invoice = self._create_invoice(self.customer1_id, Decimal("1000.00"))
        p1 = PaymentService.record_payment(
            PaymentCreate(invoice_id=invoice.id, method=PaymentMethod.CARD, amount=Decimal("100.00")),
            self.staff,
            self.db,
        )
        p2 = PaymentService.record_payment(
            PaymentCreate(invoice_id=invoice.id, method=PaymentMethod.UPI, amount=Decimal("200.00")),
            self.staff,
            self.db,
        )

        items, total = PaymentService.list_payments(invoice_id=invoice.id, db=self.db)
        self.assertEqual(total, 2)

        items_card, total_card = PaymentService.list_payments(invoice_id=invoice.id, method=PaymentMethod.CARD, db=self.db)
        self.assertEqual(total_card, 1)
        self.assertEqual(items_card[0].id, p1.id)


if __name__ == "__main__":
    unittest.main()

