# Database Task Checklist — Subscription Management System (Brightloop)

Tasks are ordered strictly according to the 7-Phase Delivery Plan [PDF 17]. All tasks owned exclusively by Sooraj: `[Sooraj]`.

---

## Phase 1: Foundation (Docker, Core Schema, Auth, Users, Audit) [PDF 17]

- [ ] **DB-1.1 [Sooraj]**: Create Docker Compose environment for PostgreSQL 16, Redis, and PgBouncer [PDF 3, 11, 14].
  - **Input**: `docker-compose.yml` defining services, healthchecks, and volume persistence.
  - **Expected Output**: Running PostgreSQL container on port 5432, Redis on 6379, PgBouncer on 6432.
  - **Acceptance Test**: `docker-compose up -d` boots all containers; `pg_isready` reports acceptance of connections.
  - **Dependencies**: None.

- [ ] **DB-1.2 [Sooraj]**: Initialize Alembic migration environment and base configurations [PDF 14, 15].
  - **Input**: Alembic directory structure (`alembic.ini`, `env.py`).
  - **Expected Output**: Migration framework configured with connection pooling and schema version tracking (`alembic_version`).
  - **Acceptance Test**: `alembic current` runs without error on fresh database.
  - **Dependencies**: DB-1.1.

- [ ] **DB-1.3 [Sooraj]**: Create Migration for Identity tables (`users`, `password_reset_tokens`, `refresh_tokens`) [PDF 5.1, 9].
  - **Input**: Schema DDL from `database/SPEC.md` section 5.1; `user_role` ENUM.
  - **Expected Output**: Migration script applying identity tables, lowercase unique email index `idx_users_email_lower`, and foreign key indexes.
  - **Acceptance Test**: Inserting duplicate email in mixed casing (e.g. `Test@example.com` and `test@example.com`) throws unique violation.
  - **Dependencies**: DB-1.2.

- [ ] **DB-1.4 [Sooraj]**: Create Migration for Support tables (`audit_logs`, `settings`) [PDF 5.10, 9].
  - **Input**: Schema DDL from `database/SPEC.md` section 5.10.
  - **Expected Output**: Migration script applying `audit_logs` with JSONB columns and timestamp index, plus `settings` key-value table.
  - **Acceptance Test**: `audit_logs` table stores before/after JSON documents cleanly.
  - **Dependencies**: DB-1.3.

---

## Phase 2: Catalog (Products, Variants, Plans, Taxes) [PDF 17]

- [ ] **DB-2.1 [Sooraj]**: Create Migration for Taxes table [PDF 5.7].
  - **Input**: Schema DDL for `taxes`, `tax_type` ENUM, `tax_applies_to` ENUM.
  - **Expected Output**: Migration creating `taxes` table with `NUMERIC(14,4)` rate column and inclusive boolean.
  - **Acceptance Test**: Inserting tax rule with rate `0.1800` succeeds.
  - **Dependencies**: DB-1.4.

- [ ] **DB-2.2 [Sooraj]**: Create Migration for Products and Product Variants tables [PDF 5.3].
  - **Input**: Schema DDL for `products`, `product_variants`, `product_type` ENUM, and composite unique constraint.
  - **Expected Output**: `products` with `sales_price`, `cost_price` as `NUMERIC(14,2)` and `product_variants` with `uq_product_variant(product_id, attribute, value)`.
  - **Acceptance Test**: Attempting to insert identical attribute and value for the same product throws unique violation error.
  - **Dependencies**: DB-2.1.

- [ ] **DB-2.3 [Sooraj]**: Create Migration for Plans table [PDF 5.4].
  - **Input**: Schema DDL for `plans` and `billing_period` ENUM.
  - **Expected Output**: `plans` table with flags (`auto_close`, `closable`, `pausable`, `renewable`, `is_active`) and `min_quantity`.
  - **Acceptance Test**: Inserting plan with daily/weekly/monthly/yearly intervals succeeds.
  - **Dependencies**: DB-2.2.

---

## Phase 3: Sales (Customers, Quotation Templates, Subscriptions) [PDF 17]

- [ ] **DB-3.1 [Sooraj]**: Create Migration for Customers table [PDF 5.2, 16].
  - **Input**: Schema DDL for `customers` with `billing_address JSONB` and `deleted_at TIMESTAMPTZ`.
  - **Expected Output**: `customers` table with soft delete support; FK link from `users.customer_id`.
  - **Acceptance Test**: Querying `WHERE deleted_at IS NULL` filters soft-deleted customers.
  - **Dependencies**: DB-1.3.

- [ ] **DB-3.2 [Sooraj]**: Create Migration for Quotation Templates tables [PDF 5.5].
  - **Input**: Schema DDL for `quotation_templates` and `quotation_template_lines`.
  - **Expected Output**: Templates tables with cascade delete on lines and FK indexes.
  - **Acceptance Test**: Deleting a template cascades delete to its line items.
  - **Dependencies**: DB-2.3, DB-3.1.

- [ ] **DB-3.3 [Sooraj]**: Create Migration for Payment Terms and Subscriptions tables [PDF 5.6, 6.1, 7.2].
  - **Input**: Schema DDL for `payment_terms`, `subscriptions`, `subscription_lines`, `subscription_status` ENUM, and sequence `subscription_number_seq`.
  - **Expected Output**: Subscriptions tables with `anchor_day` column (1-31), monetary fields `NUMERIC(14,2)`, snapshot unit price, and foreign key indexes.
  - **Acceptance Test**: Subscriptions accept status transitions; invalid `anchor_day` (e.g. 32) is rejected by CHECK constraint.
  - **Dependencies**: DB-3.2.

---

## Phase 4: Billing (Invoices, Discounts, Anti-Double-Billing Guard, Billing Runs) [PDF 17]

- [ ] **DB-4.1 [Sooraj]**: Create Migration for Discounts tables [PDF 5.8].
  - **Input**: Schema DDL for `discount_rules`, `discount_products`, `discount_type` ENUM, `discount_scope` ENUM.
  - **Expected Output**: Discounts tables with usage limit and usage counter; link table to products.
  - **Acceptance Test**: `discount_products` enforces composite primary key (`discount_id`, `product_id`).
  - **Dependencies**: DB-2.2.

- [ ] **DB-4.2 [Sooraj]**: Create Migration for Invoices and Invoice Lines tables with Anti-Double-Billing Guard [PDF 5.9, 7.2].
  - **Input**: Schema DDL for `invoices`, `invoice_lines`, `invoice_status` ENUM, sequence `invoice_number_seq`, constraint `uq_subscription_period`.
  - **Expected Output**: Invoices table with hard unique constraint `UNIQUE(subscription_id, period_start, period_end)`.
  - **Acceptance Test**: Inserting two invoice rows with identical `subscription_id`, `period_start`, and `period_end` fails with PostgreSQL unique violation error.
  - **Dependencies**: DB-3.3.

- [ ] **DB-4.3 [Sooraj]**: Create Migration for Discount Redemptions table [PDF 5.8].
  - **Input**: Schema DDL for `discount_redemptions` and constraint `uq_discount_invoice(discount_id, invoice_id)`.
  - **Expected Output**: Redemptions table linking discounts to invoices with composite unique constraint.
  - **Acceptance Test**: Attempting duplicate redemption of the same discount on the same invoice throws unique violation.
  - **Dependencies**: DB-4.1, DB-4.2.

- [ ] **DB-4.4 [Sooraj]**: Create Migration for Billing Runs and Notifications tables [PDF 5.10, 13].
  - **Input**: Schema DDL for `billing_runs` and `notifications`.
  - **Expected Output**: Support tables tracking batch job observability and email notifications.
  - **Acceptance Test**: `billing_runs` stores execution counts (`created_count`, `skipped_count`, `failed_count`).
  - **Dependencies**: DB-4.2.

---

## Phase 5: Payments (Payments Table, Overdue Index) [PDF 17]

- [ ] **DB-5.1 [Sooraj]**: Create Migration for Payments table [PDF 5.9, 7.4].
  - **Input**: Schema DDL for `payments` and `payment_method` ENUM.
  - **Expected Output**: Payments table referencing `invoices` and `users(recorded_by)` with `NUMERIC(14,2)` amount column.
  - **Acceptance Test**: Negative amount values accepted for payment reversals.
  - **Dependencies**: DB-4.2.

- [ ] **DB-5.2 [Sooraj]**: Create Migration for Key System Indexes [PDF 5.11].
  - **Input**: DDL from `database/SPEC.md` section 6:
    - `invoices(number)` unique, `subscriptions(number)` unique.
    - `subscriptions(status, next_billing_date)`.
    - `subscriptions(customer_id)`, `invoices(customer_id, status)`.
    - Partial index `invoices(status, due_date) WHERE status='confirmed' AND balance>0`.
    - `payments(invoice_id)`, `payments(payment_date)`.
    - `discount_rules(is_active, start_date, end_date)`.
  - **Expected Output**: Migration creating all 7 key performance indexes.
  - **Acceptance Test**: Index creation succeeds; `pg_indexes` confirms presence.
  - **Dependencies**: DB-5.1.

---

## Phase 6: Reports & Summary Tables [PDF 17]

- [ ] **DB-6.1 [Sooraj]**: Create Migration for Summary Tables (`daily_revenue_summary`, `subscription_snapshot_daily`) [PDF 11].
  - **Input**: Schema DDL from `database/SPEC.md` section 8.
  - **Expected Output**: Aggregation summary tables allowing reporting queries to scan hundreds of rows instead of millions.
  - **Acceptance Test**: Summary tables created with primary keys and foreign key constraints to `plans`.
  - **Dependencies**: DB-5.2.

- [ ] **DB-6.2 [Sooraj]**: Implement Refresh Stored Procedures / SQL Functions for Summary Tables [PDF 11, 13].
  - **Input**: SQL aggregation scripts calculating daily invoiced, collected totals, active subscriber counts, and MRR.
  - **Expected Output**: Callable SQL functions `refresh_daily_revenue_summary(date)` and `refresh_subscription_snapshot_daily(date)`.
  - **Acceptance Test**: Calling procedure computes and upserts summary row for the specified date.
  - **Dependencies**: DB-6.1.

---

## Phase 7: Portal, Polish, Seed Data & Backup Verification [PDF 17]

- [ ] **DB-7.1 [Sooraj]**: Build Realistic Demo Seed Script [PDF 15].
  - **Input**: Seed script `scripts/seed_demo.py` creating default superadmin (`admin@brightloop.io`), staff, products, plans, taxes, and customer contracts.
  - **Expected Output**: Populated development database with realistic demonstration dataset.
  - **Acceptance Test**: Running script on clean database completes in < 5 seconds; all entities queryable.
  - **Dependencies**: DB-6.1.

- [ ] **DB-7.2 [Sooraj]**: Build High-Volume Performance Seed Generator (50k subscriptions, 500k invoices) [PDF 11, 15].
  - **Input**: Bulk insert script `scripts/seed_large_volume.py` using PostgreSQL `COPY` or batched inserts.
  - **Expected Output**: Large-volume dataset populated in local test environment.
  - **Acceptance Test**: Database contains exactly 50,000 subscriptions and 500,000 invoices.
  - **Dependencies**: DB-7.1.

- [ ] **DB-7.3 [Sooraj]**: Verify Query Performance with `EXPLAIN ANALYZE` on Large-Volume Dataset [PDF 11, 15].
  - **Input**: Verification script `scripts/verify_indexes.py` running billing query, overdue partial index query, and customer tenant query.
  - **Expected Output**: Execution plans demonstrating index scans and execution times < 10 ms.
  - **Acceptance Test**: `EXPLAIN ANALYZE` confirms:
    - Billing query uses `idx_subscriptions_status_billing_date` (Execution time < 10 ms).
    - Overdue query uses `idx_invoices_overdue_partial` (Execution time < 5 ms).
    - Customer portal query uses `idx_invoices_customer_id_status` (Execution time < 2 ms).
  - **Dependencies**: DB-7.2.

- [ ] **DB-7.4 [Sooraj]**: Implement Automated Backup and Restore Verification Script [PDF 15].
  - **Input**: Shell script `scripts/backup_and_restore_test.sh` executing `pg_dump`, creating a test database, and restoring dump.
  - **Expected Output**: Validated backup and recovery workflow running in CI pipeline.
  - **Acceptance Test**: Dump and restore completes with exit code 0; table row counts match pre-backup values exactly.
  - **Dependencies**: DB-1.1.
