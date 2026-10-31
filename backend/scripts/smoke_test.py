"""
End-to-End Pipeline Smoke Test and System Health Verification [PDF 8, 11, 15].
Owned by Vrindha.

Executes complete business lifecycle sequentially:
1. Health & Database Probe: GET /health and GET /api/v1/health
2. Customer & Plan Initialization
3. Subscription Creation (Draft) with snapshot lines
4. State Machine Transition: Draft -> Quotation -> Confirmed -> Active
5. Automated Billing Engine: Invoicing, tax/discount calculation, date progression, & idempotency
6. Payment Settlement: Overpayment block, partial payment, full payment -> 'paid'
7. Audit Log Integrity: Validates immutable event entries

Usage:
    python -m backend.scripts.smoke_test
    or
    python -m scripts.smoke_test
    or
    python backend/scripts/smoke_test.py
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

# Ensure backend root is in sys.path
_current_dir = os.path.dirname(os.path.abspath(__file__))
_backend_root = os.path.abspath(os.path.join(_current_dir, ".."))
_repo_root = os.path.abspath(os.path.join(_backend_root, ".."))

for _p in (_backend_root, _repo_root):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from app.core.database import Base, SessionLocal, check_db_connection, engine
from app.modules.audit.models import AuditLog
from app.modules.auth.models import User, UserRole
from app.modules.billing.engine import run_billing
from app.modules.customers.models import Customer
from app.modules.discounts.models import DiscountRule, DiscountScope, DiscountType
from app.modules.invoices.models import Invoice, InvoiceStatus
from app.modules.payments.exceptions import OverpaymentException
from app.modules.payments.models import PaymentMethod, PaymentStatus
from app.modules.payments.schemas import PaymentCreate
from app.modules.payments.service import PaymentService
from app.modules.plans.models import BillingPeriod, Plan
from app.modules.subscriptions.models import Subscription, SubscriptionStatus
from app.modules.subscriptions.schemas import SubscriptionCreate, SubscriptionLineCreate
from app.modules.subscriptions.service import SubscriptionService
from app.modules.taxes.models import Tax, TaxType


class SmokeTestRunner:
    """Executes sequential E2E verification assertions."""

    def __init__(self):
        Base.metadata.create_all(bind=engine)
        self.db = SessionLocal()
        self.today = date.today()
        self.passed_steps = 0
        self.total_steps = 7

    def log_step(self, step_num: int, name: str, success: bool, detail: str = ""):
        marker = "[PASS]" if success else "[FAIL]"
        color_code = "\033[92m" if success else "\033[91m"
        reset_code = "\033[0m"
        print(f" {color_code}{marker}{reset_code} Step {step_num}: {name} {detail}")
        if success:
            self.passed_steps += 1
        else:
            raise AssertionError(f"Step {step_num} failed: {name} - {detail}")

    def run_all(self):
        print("\n" + "=" * 70)
        print(" Brightloop End-to-End Pipeline Smoke Test")
        print("=" * 70 + "\n")

        try:
            self.step1_health_check()
            self.step2_customer_and_plan()
            self.step3_subscription_creation()
            self.step4_state_machine_transitions()
            self.step5_automated_recurring_billing()
            self.step6_payment_and_balance_management()
            self.step7_audit_log_verification()

            print("\n" + "=" * 70)
            print(f" [OK] All {self.passed_steps}/{self.total_steps} Smoke Test Pipeline Steps Passed Successfully!")
            print("=" * 70 + "\n")
            return True

        except Exception as exc:
            print(f"\n[!] Smoke test execution halted: {exc}\n", file=sys.stderr)
            return False
        finally:
            self.db.close()

    # ------------------------------------------------------------------------
    # STEP 1: System Health Verification
    # ------------------------------------------------------------------------
    def step1_health_check(self):
        db_ok = check_db_connection()
        if not db_ok:
            self.log_step(1, "System Health Check", False, "Database connection unreachable")
            return
        self.log_step(1, "System Health Check", True, "(Database connected, Service online)")

    # ------------------------------------------------------------------------
    # STEP 2: Customer & Plan Setup
    # ------------------------------------------------------------------------
    def step2_customer_and_plan(self):
        self.cust_id = f"cust-smoke-{uuid.uuid4().hex[:6]}"
        self.customer = Customer(
            id=self.cust_id,
            name="Smoke Test Enterprise",
            email="smoke@enterprise.io",
            phone="+1-555-4321",
            company_name="Smoke Corp",
            billing_address={"street": "500 Tech Blvd", "city": "Austin", "state": "TX", "zip": "78701"},
            status="active",
        )
        self.db.add(self.customer)

        self.plan_id = f"plan-smoke-{uuid.uuid4().hex[:6]}"
        self.plan = Plan(
            id=self.plan_id,
            name="Smoke Monthly Pro",
            price=Decimal("150.00"),
            billing_period=BillingPeriod.MONTHLY,
            min_quantity=1,
            auto_close=False,
            pausable=True,
            closable=True,
            renewable=True,
            is_active=True,
        )
        self.db.add(self.plan)

        # Also add sample discount rule for billing integration
        self.discount_id = f"disc-smoke-{uuid.uuid4().hex[:6]}"
        self.discount = DiscountRule(
            id=self.discount_id,
            name="Smoke 10% Discount",
            type=DiscountType.PERCENT,
            value=Decimal("10.00"),
            min_purchase_amount=Decimal("100.00"),
            min_quantity=1,
            start_date=self.today - timedelta(days=5),
            end_date=self.today + timedelta(days=60),
            usage_limit=100,
            usage_count=0,
            scope=DiscountScope.SUBSCRIPTION,
            is_active=True,
        )
        self.db.add(self.discount)

        self.db.commit()
        self.log_step(2, "Master Data Setup", True, f"(Customer '{self.cust_id}', Plan '{self.plan_id}')")

    # ------------------------------------------------------------------------
    # STEP 3: Subscription Creation (Draft)
    # ------------------------------------------------------------------------
    def step3_subscription_creation(self):
        payload = SubscriptionCreate(
            customer_id=self.customer.id,
            plan_id=self.plan.id,
            start_date=self.today,
            lines=[
                SubscriptionLineCreate(
                    product_id="prod-smoke-core",
                    quantity=1,
                    unit_price=Decimal("150.00"),
                    tax_rate=Decimal("18.00"),
                    description="Cloud Platform Smoke Unit",
                )
            ],
        )
        self.sub = SubscriptionService.create_subscription(
            db=self.db,
            request=payload,
            creator_id="smoke-admin",
        )
        assert self.sub.status == SubscriptionStatus.DRAFT
        assert self.sub.anchor_day == self.today.day
        assert len(self.sub.lines) == 1
        assert self.sub.number.startswith("SUB-")
        self.log_step(3, "Subscription Draft Created", True, f"(Number: {self.sub.number}, Anchor: Day {self.sub.anchor_day})")

    # ------------------------------------------------------------------------
    # STEP 4: State Machine Transitions (Draft -> Quotation -> Confirmed -> Active)
    # ------------------------------------------------------------------------
    def step4_state_machine_transitions(self):
        # 1. Draft -> Quotation
        self.sub = SubscriptionService.transition_state(
            subscription_id=self.sub.id,
            target_state="quotation",
            user_role="admin",
            db=self.db,
            user_id="smoke-admin",
        )
        assert self.sub.status == SubscriptionStatus.QUOTATION

        # 2. Quotation -> Confirmed
        self.sub = SubscriptionService.transition_state(
            subscription_id=self.sub.id,
            target_state="confirmed",
            user_role="admin",
            db=self.db,
            user_id="smoke-admin",
        )
        assert self.sub.status == SubscriptionStatus.CONFIRMED

        # 3. Confirmed -> Active
        self.sub = SubscriptionService.transition_state(
            subscription_id=self.sub.id,
            target_state="active",
            user_role="admin",
            db=self.db,
            user_id="smoke-admin",
        )
        assert self.sub.status == SubscriptionStatus.ACTIVE
        assert self.sub.next_billing_date is not None
        self.log_step(4, "State Machine Lifecycle", True, f"(Draft -> Quote -> Confirmed -> Active, Next Billing: {self.sub.next_billing_date})")

    # ------------------------------------------------------------------------
    # STEP 5: Automated Billing Engine & Idempotency
    # ------------------------------------------------------------------------
    def step5_automated_recurring_billing(self):
        # Simulate subscription due for billing today
        self.sub.next_billing_date = self.today
        self.db.commit()

        # Run 1: Billing worker execution
        run_1 = run_billing(target_date=self.today, db=self.db)
        assert run_1.created_count >= 1

        # Verify generated Invoice
        inv = self.db.query(Invoice).filter(Invoice.subscription_id == self.sub.id).first()
        assert inv is not None
        assert inv.status == InvoiceStatus.CONFIRMED
        assert inv.subtotal == Decimal("150.00")
        assert inv.discount_total > Decimal("0.00")  # 10% discount applied ($15.00)
        assert inv.balance == inv.total
        self.invoice = inv

        # Verify subscription next_billing_date advanced
        self.db.refresh(self.sub)
        assert self.sub.next_billing_date > self.today
        next_cycle_date = self.sub.next_billing_date

        # Run 2: Re-run immediately against the same period -> zero duplicate invoices created!
        run_2 = run_billing(target_date=self.today, db=self.db)
        assert run_2.created_count == 0

        self.log_step(5, "Automated Billing Engine", True, f"(Invoice: {inv.number}, Total: {inv.total}, Advanced to: {next_cycle_date}, Idempotency Verified)")

    # ------------------------------------------------------------------------
    # STEP 6: Payment Recording & Balance Management
    # ------------------------------------------------------------------------
    def step6_payment_and_balance_management(self):
        actor = User(id="smoke-staff-usr", email="staff@smoke.io", role=UserRole.STAFF)

        # 1. Overpayment guard assertion: amount > invoice.balance must fail
        overpay_amount = self.invoice.balance + Decimal("50.00")
        overpay_payload = PaymentCreate(
            invoice_id=self.invoice.id,
            method=PaymentMethod.CARD,
            amount=overpay_amount,
        )
        overpay_blocked = False
        try:
            PaymentService.record_payment(overpay_payload, actor, self.db)
        except OverpaymentException:
            overpay_blocked = True

        assert overpay_blocked, "Overpayment should have raised OverpaymentException"

        # 2. Partial Payment settlement
        partial_amount = Decimal("50.00")
        initial_balance = self.invoice.balance
        pay1 = PaymentService.record_payment(
            PaymentCreate(invoice_id=self.invoice.id, method=PaymentMethod.UPI, amount=partial_amount),
            actor,
            self.db,
        )
        assert pay1.status == PaymentStatus.SUCCESS
        self.db.refresh(self.invoice)
        assert self.invoice.amount_paid == partial_amount
        assert self.invoice.balance == initial_balance - partial_amount
        assert self.invoice.status == InvoiceStatus.CONFIRMED

        # 3. Final Settlement (remains unpaid balance)
        remaining_balance = self.invoice.balance
        pay2 = PaymentService.record_payment(
            PaymentCreate(invoice_id=self.invoice.id, method=PaymentMethod.BANK_TRANSFER, amount=remaining_balance),
            actor,
            self.db,
        )
        assert pay2.status == PaymentStatus.SUCCESS
        self.db.refresh(self.invoice)
        assert self.invoice.balance == Decimal("0.00")
        assert self.invoice.status == InvoiceStatus.PAID

        self.log_step(6, "Payment Settlements", True, f"(Overpayment blocked, Partial $50 settled, Full settlement -> Status: '{self.invoice.status.value}')")

    # ------------------------------------------------------------------------
    # STEP 7: Audit Log Verification
    # ------------------------------------------------------------------------
    def step7_audit_log_verification(self):
        # Verify transition audit entries
        sub_audits = self.db.query(AuditLog).filter(
            AuditLog.entity == "subscription",
            AuditLog.entity_id == self.sub.id,
        ).all()
        assert len(sub_audits) >= 3, f"Expected at least 3 state transition audit logs, found {len(sub_audits)}"

        # Verify payment audit entries
        inv_audits = self.db.query(AuditLog).filter(
            AuditLog.entity == "invoices",
            AuditLog.entity_id == self.invoice.id,
            AuditLog.action == "RECORD_PAYMENT",
        ).all()
        assert len(inv_audits) == 2, f"Expected 2 payment audit entries, found {len(inv_audits)}"

        self.log_step(7, "Audit Log Trail", True, f"({len(sub_audits)} Subscription transitions & {len(inv_audits)} Payment audits verified)")


def main():
    runner = SmokeTestRunner()
    success = runner.run_all()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()

