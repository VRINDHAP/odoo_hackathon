# Database Definition of Done — Subscription Management System (Brightloop)

All items must be satisfied and verified by Sooraj before database deliverables are considered complete.

---

## 1. Non-Negotiable Core Guarantees [PDF 1, 5, 7, 11]
- [ ] **No Double Billing Hard Constraint**: Invariant composite unique constraint `UNIQUE(subscription_id, period_start, period_end)` on `invoices` table is deployed and tested with duplicate insert attempts [PDF 5.9, 7.2].
- [ ] **Financial Precision Guarantee**: Every financial column across all tables (`sales_price`, `cost_price`, `price`, `unit_price`, `subtotal`, `discount_total`, `tax_total`, `total`, `amount_paid`, `balance`, `amount`) is typed strictly as `NUMERIC(14,2)`; rate columns typed as `NUMERIC(14,4)` (zero floats) [PDF 5].
- [ ] **100% Foreign Key Indexing**: Every single foreign key column across all tables is verified to possess a dedicated B-tree index [PDF 5].
- [ ] **Soft Delete Support**: `deleted_at TIMESTAMPTZ` column and partial index present on tables requiring audit retention (`customers`, `products`, `plans`, `discount_rules`) [PDF 5, 16].
- [ ] **Query Execution Performance**: `EXPLAIN ANALYZE` confirms that core queries execute in under 10 ms under 50,000 subscriptions and 500,000 invoices [PDF 11, 15].
- [ ] **Relational SQL Database Compliance**: PostgreSQL 16+ (or MySQL 8+) schema strictly verified; zero usage of MongoDB, Firebase, or external BaaS; full relational integrity with foreign keys, checks, and composite unique constraints [PDF 3, 5].
- [ ] **Self-Contained Local Setup**: Docker Compose boots Postgres, Redis, and PgBouncer without requiring third-party cloud accounts or external SaaS database APIs.

---

## 2. Key Indexes Verification [PDF 5.11]
Verify presence and usage of all design specification indexes via `pg_indexes`:
- [ ] `idx_users_email_lower` on `users(LOWER(email))` (UNIQUE) [PDF 5.11].
- [ ] `idx_uq_invoices_number` on `invoices(number)` (UNIQUE) [PDF 5.11].
- [ ] `idx_uq_subscriptions_number` on `subscriptions(number)` (UNIQUE) [PDF 5.11].
- [ ] `idx_subscriptions_status_billing_date` on `subscriptions(status, next_billing_date)` [PDF 5.11].
- [ ] `idx_subscriptions_customer_id` on `subscriptions(customer_id)` [PDF 5.11].
- [ ] `idx_invoices_customer_id_status` on `invoices(customer_id, status)` [PDF 5.11].
- [ ] `idx_invoices_overdue_partial` on `invoices(status, due_date) WHERE status = 'confirmed' AND balance > 0` (PARTIAL INDEX) [PDF 5.11].
- [ ] `idx_payments_invoice_id` on `payments(invoice_id)` [PDF 5.11].
- [ ] `idx_payments_payment_date` on `payments(payment_date)` [PDF 5.11].
- [ ] `idx_discount_rules_eligibility` on `discount_rules(is_active, start_date, end_date)` [PDF 5.11].

---

## 3. Performance & Summary Tables Verification [PDF 11]
- [ ] Summary tables `daily_revenue_summary` and `subscription_snapshot_daily` deployed with primary keys and foreign keys [PDF 11].
- [ ] Refresh procedures `refresh_daily_revenue_summary()` and `refresh_subscription_snapshot_daily()` successfully populate summary data [PDF 11].
- [ ] Dashboard queries executed against summary tables return within 15 ms, avoiding full table scans of raw transaction rows [PDF 11].

---

## 4. Environment & Tooling Verification [PDF 3, 11, 14, 15]
- [ ] **Docker Compose**: `docker-compose up -d` boots PostgreSQL 16, Redis 7, and PgBouncer cleanly with health checks passing [PDF 3, 11, 14].
- [ ] **PgBouncer Pooling**: Transaction mode pooling functional on port 6432; handles 500 simulated concurrent connections without connection drop [PDF 11].
- [ ] **Alembic Migration Pipeline**:
  - `alembic upgrade head` applies all migrations cleanly on a clean database [PDF 14].
  - `alembic downgrade base` cleanly reverts all migrations without error [PDF 15].
  - CI migration check script asserts zero uncommitted model changes [PDF 15].
- [ ] **Seed Data Scripts**:
  - Realistic demo dataset script seeds superadmin, staff, products, plans, and active contracts [PDF 15].
  - Large-volume performance script successfully generates 50,000 subscriptions and 500,000 invoices [PDF 11, 15].
- [ ] **Backup and Restore**: Automated test restore script completes successfully in CI, dumping and recreating database with 100% row count fidelity [PDF 15].
