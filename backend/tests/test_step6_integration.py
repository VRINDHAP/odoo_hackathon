"""
Integration & Smoke Tests for Step 6: App Integration and Router Wiring [PDF 8, 11].
Owned by Vrindha.
"""
from __future__ import annotations

import unittest

from app.main import app
from app.core.database import Base, engine
from app.modules.common.dependencies import (
    MockUser,
    get_current_customer,
    get_current_user,
    require_admin,
    require_staff_or_admin,
)
from app.core.errors import ForbiddenError, UnauthorizedError


class TestStep6AppIntegration(unittest.TestCase):
    """Smoke tests verifying app bootstrap, OpenAPI schema, metadata tables, and fallback dependencies."""

    def test_openapi_schema_contains_all_modules_and_tags(self):
        """Verify OpenAPI schema contains Subscriptions, Discounts, Billing, and Payments endpoints and tags."""
        schema = app.openapi()
        paths = schema.get("paths", {})

        # Subscriptions endpoints
        self.assertIn("/api/v1/subscriptions", paths)
        self.assertIn("/api/v1/me/subscriptions", paths)
        self.assertIn("/api/v1/subscriptions/{id}", paths)
        self.assertIn("/api/v1/subscriptions/{id}/transition", paths)
        self.assertIn("/api/v1/subscriptions/{id}/pause", paths)
        self.assertIn("/api/v1/subscriptions/{id}/resume", paths)
        self.assertIn("/api/v1/subscriptions/{id}/close", paths)
        self.assertIn("/api/v1/subscriptions/{id}/renew", paths)

        # Discounts endpoints
        self.assertIn("/api/v1/discounts", paths)
        self.assertIn("/api/v1/discounts/{id}", paths)
        self.assertIn("/api/v1/discounts/{id}/usage", paths)
        self.assertIn("/api/v1/discounts/evaluate", paths)

        # Billing endpoints
        self.assertIn("/api/v1/billing/run", paths)
        self.assertIn("/api/v1/billing/runs", paths)

        # Payments endpoints
        self.assertIn("/api/v1/payments", paths)
        self.assertIn("/api/v1/payments/{id}/reverse", paths)
        self.assertIn("/api/v1/invoices/{id}/payments", paths)
        self.assertIn("/api/v1/me/invoices/{id}/pay", paths)

        # Verify tags
        all_tags = set()
        for path_item in paths.values():
            for method in ("get", "post", "put", "patch", "delete"):
                if method in path_item:
                    all_tags.update(path_item[method].get("tags", []))

        self.assertIn("Subscriptions", all_tags)
        self.assertIn("Discounts", all_tags)
        self.assertIn("Billing", all_tags)
        self.assertIn("Payments", all_tags)

    def test_database_metadata_contains_all_models(self):
        """Verify Base.metadata registers all required tables from app.core.database."""
        tables = set(Base.metadata.tables.keys())
        expected_tables = {
            "subscriptions",
            "subscription_lines",
            "discount_rules",
            "discount_products",
            "discount_redemptions",
            "billing_runs",
            "invoices",
            "invoice_lines",
            "payments",
            "audit_logs",
            "users",
        }
        for tbl in expected_tables:
            self.assertIn(tbl, tables, f"Expected table '{tbl}' not found in Base.metadata")

    def test_common_fallback_dependencies(self):
        """Verify mockable dependencies in app.modules.common.dependencies."""
        # 1. Test header injection: admin
        admin_user = get_current_user(x_test_role="admin", x_test_user_id="usr-1")
        self.assertEqual(admin_user.role.value, "admin")
        self.assertEqual(require_admin(admin_user).role.value, "admin")
        self.assertEqual(require_staff_or_admin(admin_user).role.value, "admin")

        # 2. Staff user
        staff_user = get_current_user(x_test_role="staff", x_test_user_id="usr-2")
        self.assertEqual(require_staff_or_admin(staff_user).role.value, "staff")
        with self.assertRaises(ForbiddenError):
            require_admin(staff_user)

        # 3. Customer user with customer_id
        cust_user = get_current_user(x_test_role="customer", x_test_customer_id="cust-123")
        self.assertEqual(get_current_customer(cust_user).customer_id, "cust-123")

        # 4. Customer without customer_id
        cust_user_no_id = MockUser(role="customer", customer_id=None)
        with self.assertRaises(ForbiddenError):
            get_current_customer(cust_user_no_id)

        # 5. Missing auth token
        with self.assertRaises(UnauthorizedError):
            get_current_user()


if __name__ == "__main__":
    unittest.main()
