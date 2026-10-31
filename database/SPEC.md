# Database Specification — Subscription Management System (Brightloop)

## 1. Product Goal & Scope [PDF 1]
- Provide a robust, highly optimized relational database architecture running the full subscription lifecycle: catalog -> quotation -> subscription -> invoice -> payment -> reporting [PDF 1].
- **Hackathon High-Value Evaluation Focus**: The database design and setup is the most heavily scrutinized layer by the judges. It showcases schema normalization, strict relational typing, query optimization, dynamic data aggregation, and infrastructure setup automation.
- Enforce foundational database guarantees:
  - **No double billing**: Hard database-level composite unique constraint `UNIQUE(subscription_id, period_start, period_end)` [PDF 1, 5.9, 7.2].
  - **Idempotent batch processing**: Efficient row-level locking via `FOR UPDATE SKIP LOCKED` on active subscriptions [PDF 7.2].
  - **Financial precision**: `NUMERIC(14,2)` on all monetary columns (never float) [PDF 5].
  - **Real-time & dynamic summary tables**: `daily_revenue_summary` and `subscription_snapshot_daily` refreshed dynamically to ensure live dashboard queries read hundreds of rows instead of millions [PDF 11].
  - **Performance threshold**: Index design validated via `EXPLAIN ANALYZE` on 50,000 subscriptions and 500,000 invoices ensuring API p95 < 300 ms and page load < 2 s [PDF 1, 11].

---

## 2. Actors & Access Control (DB Layer) [PDF 2]
- Support Layer 3 of the 3-layer RBAC architecture [PDF 2]:
  - All portal-facing queries execute with strict tenant filtering: `WHERE customer_id = :authenticated_customer_id` [PDF 2, 9].
  - Every foreign key on `customer_id` must be indexed to ensure instant object-level lookups and customer data isolation [PDF 2, 5, 5.11].
  - Role validation supported via database ENUM `user_role` (`admin`, `staff`, `customer`) [PDF 2, 5.1].

---

## 3. Database Architecture [PDF 3]
- **Relational SQL Database Mandate**: All persistence must run on PostgreSQL 16+ (or MySQL 8+) [PDF 3].
  - Multi-table financial operations (invoices + discount redemptions + subscription date progression) require atomic relational ACID transactions [PDF 3, 7.2].
  - Hard relational foreign keys and composite unique constraints (`UNIQUE(subscription_id, period_start, period_end)`) are mandatory [PDF 5.9].
  - NoSQL document databases (MongoDB, Firebase Firestore, Firebase Realtime Database, CouchDB, DynamoDB) and cloud BaaS platforms are strictly forbidden.
- **Topology**: PostgreSQL 16+ Primary (writes, transactional workloads) + Read Replica (read-heavy reports, background analytics) [PDF 3, 11].
- **Connection Pooling**: PgBouncer sitting in front of PostgreSQL handling pooled client connections to prevent pool exhaustion during concurrent worker runs [PDF 11].
- **Transaction Boundaries**: Single atomic database transaction wraps invoice creation, line items, tax and discount redemptions, discount usage counter increment, and subscription billing date progression [PDF 3, 7.2].
- **Self-Contained Infrastructure**: Entire database layer runs locally via Docker Compose, eliminating reliance on third-party cloud database APIs or external vendor locks [PDF 14].

---

## 4. Module Storage Mapping [PDF 4]
The database schema maps all 12 platform modules [PDF 4]:
1. `auth` & `users` -> `users`, `password_reset_tokens`, `refresh_tokens` [PDF 4, 5.1].
2. `customers` -> `customers` [PDF 4, 5.2].
3. `catalog` -> `products`, `product_variants` [PDF 4, 5.3].
4. `plans` -> `plans` [PDF 4, 5.4].
5. `templates` -> `quotation_templates`, `quotation_template_lines` [PDF 4, 5.5].
6. `subscriptions` -> `subscriptions`, `subscription_lines`, `payment_terms` [PDF 4, 5.6].
7. `taxes` -> `taxes` [PDF 4, 5.7].
8. `discounts` -> `discount_rules`, `discount_products`, `discount_redemptions` [PDF 4, 5.8].
9. `invoices` -> `invoices`, `invoice_lines` [PDF 4, 5.9].
10. `payments` -> `payments` [PDF 4, 5.9].
11. `reports` -> `daily_revenue_summary`, `subscription_snapshot_daily` [PDF 4, 11].
12. `notifications`, `audit` & `jobs` -> `audit_logs`, `notifications`, `settings`, `billing_runs` [PDF 4, 5.10].

---

## 5. Low-Level Database Schema Specifications [PDF 5]

### Global DDL Conventions [PDF 5]
- **Primary Keys**: UUID (`DEFAULT gen_random_uuid()`) or `BIGSERIAL` [PDF 5].
- **Audit Columns**: `created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()`, `created_by UUID NULL REFERENCES users(id)` [PDF 5].
- **Soft Deletes**: `deleted_at TIMESTAMPTZ NULL` where historical contracts and invoices must persist [PDF 5, 16].
- **Monetary Types**: Strictly `NUMERIC(14,2)` (never float) [PDF 5].
- **Document Currency**: `currency VARCHAR(3) NOT NULL DEFAULT 'INR'` on all financial headers [PDF 5].
- **Foreign Keys**: Every single foreign key column MUST have a dedicated B-tree index [PDF 5].

---

### 5.1 Identity Tables [PDF 5.1]

#### `users` [PDF 5.1]
```sql
CREATE TYPE user_role AS ENUM ('admin', 'staff', 'customer');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL,
    customer_id UUID NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ NULL,
    last_login_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Case-insensitive unique email index [PDF 5.1, 8]
CREATE UNIQUE INDEX idx_users_email_lower ON users (LOWER(email));
CREATE INDEX idx_users_customer_id ON users (customer_id);
```

#### `password_reset_tokens` [PDF 5.1, 9]
```sql
CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL, -- SHA-256 hash of 256-bit token
    expires_at TIMESTAMPTZ NOT NULL, -- 30 minutes from creation
    used_at TIMESTAMPTZ NULL,
    requested_ip VARCHAR(45) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_pwd_reset_token_hash ON password_reset_tokens (token_hash);
CREATE INDEX idx_pwd_reset_user_id ON password_reset_tokens (user_id);
```

#### `refresh_tokens` [PDF 5.1, 9]
```sql
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL, -- 7 days
    revoked_at TIMESTAMPTZ NULL,
    device VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_refresh_token_hash ON refresh_tokens (token_hash);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens (user_id);
```

---

### 5.2 Customers Table [PDF 5.2]

#### `customers` [PDF 5.2]
```sql
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NULL,
    company_name VARCHAR(255) NULL,
    tax_id VARCHAR(50) NULL,
    billing_address JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    deleted_at TIMESTAMPTZ NULL, -- Soft delete [PDF 5, 16]
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE users ADD CONSTRAINT fk_users_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX idx_customers_email ON customers (email);
CREATE INDEX idx_customers_deleted_at ON customers (deleted_at);
```

---

### 5.3 Catalog Tables [PDF 5.3]

#### `products` [PDF 5.3]
```sql
CREATE TYPE product_type AS ENUM ('service', 'software', 'addon', 'physical');

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type product_type NOT NULL,
    sales_price NUMERIC(14,2) NOT NULL,
    cost_price NUMERIC(14,2) NOT NULL,
    notes TEXT NULL,
    tax_id UUID NULL, -- FK to taxes added after taxes table created
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_products_is_active ON products (is_active);
```

#### `product_variants` [PDF 5.3]
```sql
CREATE TABLE product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    attribute VARCHAR(100) NOT NULL, -- e.g. 'Brand'
    value VARCHAR(100) NOT NULL,     -- e.g. 'Odoo'
    extra_price NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_product_variant UNIQUE (product_id, attribute, value)
);

CREATE INDEX idx_variants_product_id ON product_variants (product_id);
```

---

### 5.4 Plans Table [PDF 5.4]

#### `plans` [PDF 5.4]
```sql
CREATE TYPE billing_period AS ENUM ('daily', 'weekly', 'monthly', 'yearly');

CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    price NUMERIC(14,2) NOT NULL,
    billing_period billing_period NOT NULL,
    min_quantity INTEGER NOT NULL DEFAULT 1,
    valid_from DATE NOT NULL,
    valid_to DATE NULL,
    auto_close BOOLEAN NOT NULL DEFAULT FALSE,
    closable BOOLEAN NOT NULL DEFAULT TRUE,
    pausable BOOLEAN NOT NULL DEFAULT TRUE,
    renewable BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_plans_is_active ON plans (is_active);
```

---

### 5.5 Quotation Templates Tables [PDF 5.5]

#### `quotation_templates` [PDF 5.5]
```sql
CREATE TABLE quotation_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    validity_days INTEGER NOT NULL DEFAULT 30,
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_templates_plan_id ON quotation_templates (plan_id);
```

#### `quotation_template_lines` [PDF 5.5]
```sql
CREATE TABLE quotation_template_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES quotation_templates(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id UUID NULL REFERENCES product_variants(id) ON DELETE SET NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price NUMERIC(14,2) NOT NULL
);

CREATE INDEX idx_template_lines_template_id ON quotation_template_lines (template_id);
CREATE INDEX idx_template_lines_product_id ON quotation_template_lines (product_id);
```

---

### 5.6 Taxes Table [PDF 5.7]

#### `taxes` [PDF 5.7]
```sql
CREATE TYPE tax_type AS ENUM ('percent', 'fixed');
CREATE TYPE tax_applies_to AS ENUM ('all', 'product', 'category');

CREATE TABLE taxes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL, -- e.g. 'GST 18%'
    type tax_type NOT NULL,
    rate NUMERIC(14,4) NOT NULL, -- e.g. 0.1800 or fixed amount
    inclusive BOOLEAN NOT NULL DEFAULT FALSE,
    applies_to tax_applies_to NOT NULL DEFAULT 'all',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE products ADD CONSTRAINT fk_products_tax FOREIGN KEY (tax_id) REFERENCES taxes(id) ON DELETE SET NULL;
CREATE INDEX idx_products_tax_id ON products (tax_id);
```

---

### 5.7 Payment Terms & Subscriptions Tables [PDF 5.6]

#### `payment_terms` [PDF 5.6]
```sql
CREATE TABLE payment_terms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL, -- e.g. 'Immediate', 'Net 15', 'Net 30'
    days INTEGER NOT NULL DEFAULT 0
);
```

#### `subscriptions` [PDF 5.6, 6.1, 7.2]
```sql
CREATE TYPE subscription_status AS ENUM ('draft', 'quotation', 'confirmed', 'active', 'paused', 'closed', 'cancelled');
CREATE SEQUENCE subscription_number_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number VARCHAR(50) NOT NULL UNIQUE, -- Generated from sequence, e.g. 'SUB-2026-000001'
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    template_id UUID NULL REFERENCES quotation_templates(id) ON DELETE SET NULL,
    status subscription_status NOT NULL DEFAULT 'draft',
    start_date DATE NOT NULL,
    expiry_date DATE NULL,
    next_billing_date DATE NULL,
    last_billed_through DATE NULL,
    anchor_day SMALLINT NOT NULL CHECK (anchor_day BETWEEN 1 AND 31), -- Calendar clamp stabilization [PDF 7.2]
    payment_term_id UUID NOT NULL REFERENCES payment_terms(id) ON DELETE RESTRICT,
    quote_valid_until DATE NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    subtotal NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    discount_total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    tax_total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    paused_at TIMESTAMPTZ NULL,
    closed_at TIMESTAMPTZ NULL,
    close_reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
```

#### `subscription_lines` [PDF 5.6]
```sql
CREATE TABLE subscription_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id UUID NULL REFERENCES product_variants(id) ON DELETE SET NULL,
    description VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price NUMERIC(14,2) NOT NULL, -- Snapshot unit price [PDF 5.6]
    tax_id UUID NULL REFERENCES taxes(id) ON DELETE RESTRICT, -- Snapshot tax [PDF 5.6]
    discount_id UUID NULL, -- FK added after discount_rules created
    line_subtotal NUMERIC(14,2) NOT NULL,
    line_tax NUMERIC(14,2) NOT NULL,
    line_total NUMERIC(14,2) NOT NULL
);

CREATE INDEX idx_sub_lines_subscription_id ON subscription_lines (subscription_id);
CREATE INDEX idx_sub_lines_product_id ON subscription_lines (product_id);
```

---

### 5.8 Discounts Tables [PDF 5.8]

#### `discount_rules` [PDF 5.8]
```sql
CREATE TYPE discount_type AS ENUM ('percent', 'fixed');
CREATE TYPE discount_scope AS ENUM ('product', 'subscription');

CREATE TABLE discount_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type discount_type NOT NULL,
    value NUMERIC(14,2) NOT NULL,
    min_purchase_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    min_quantity INTEGER NOT NULL DEFAULT 0,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    usage_limit INTEGER NULL,
    usage_count INTEGER NOT NULL DEFAULT 0,
    scope discount_scope NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE subscription_lines ADD CONSTRAINT fk_sub_lines_discount FOREIGN KEY (discount_id) REFERENCES discount_rules(id) ON DELETE SET NULL;
```

#### `discount_products` [PDF 5.8]
```sql
CREATE TABLE discount_products (
    discount_id UUID NOT NULL REFERENCES discount_rules(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    PRIMARY KEY (discount_id, product_id)
);

CREATE INDEX idx_discount_products_product_id ON discount_products (product_id);
```

---

### 5.9 Invoices, Redemptions & Payments Tables [PDF 5.8, 5.9]

#### `invoices` [PDF 5.9]
```sql
CREATE TYPE invoice_status AS ENUM ('draft', 'confirmed', 'paid', 'cancelled');
CREATE SEQUENCE invoice_number_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number VARCHAR(50) NOT NULL UNIQUE, -- e.g. 'INV-2026-000001'
    subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    status invoice_status NOT NULL DEFAULT 'draft',
    invoice_date DATE NOT NULL,
    due_date DATE NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    subtotal NUMERIC(14,2) NOT NULL,
    discount_total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    tax_total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    total NUMERIC(14,2) NOT NULL,
    amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    balance NUMERIC(14,2) NOT NULL,
    sent_at TIMESTAMPTZ NULL,
    pdf_url VARCHAR(500) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    -- NON-NEGOTIABLE ANTI-DOUBLE-BILLING GUARD [PDF 5.9, 7.2]
    CONSTRAINT uq_subscription_period UNIQUE (subscription_id, period_start, period_end)
);
```

#### `invoice_lines` [PDF 5.9]
```sql
CREATE TABLE invoice_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    description VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(14,2) NOT NULL,
    discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    tax_id UUID NULL REFERENCES taxes(id) ON DELETE RESTRICT,
    tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    line_total NUMERIC(14,2) NOT NULL
);

CREATE INDEX idx_invoice_lines_invoice_id ON invoice_lines (invoice_id);
```

#### `discount_redemptions` [PDF 5.8]
```sql
CREATE TABLE discount_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discount_id UUID NOT NULL REFERENCES discount_rules(id) ON DELETE RESTRICT,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    amount NUMERIC(14,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_discount_invoice UNIQUE (discount_id, invoice_id)
);

CREATE INDEX idx_discount_redemptions_sub_id ON discount_redemptions (subscription_id);
```

#### `payments` [PDF 5.9, 7.4]
```sql
CREATE TYPE payment_method AS ENUM ('card', 'upi', 'bank_transfer', 'cash', 'cheque', 'other');

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    method payment_method NOT NULL,
    amount NUMERIC(14,2) NOT NULL, -- Negative for reversals [PDF 7.4]
    payment_date TIMESTAMPTZ NOT NULL,
    reference VARCHAR(255) NULL,
    note TEXT NULL,
    recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(50) NOT NULL DEFAULT 'completed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
```

---

### 5.10 Support Tables [PDF 5.10]

#### `audit_logs` [PDF 5.10, 9]
```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    entity VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    before_json JSONB NULL,
    after_json JSONB NULL,
    ip VARCHAR(45) NULL,
    at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_audit_logs_entity ON audit_logs (entity, entity_id);
CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_id);
CREATE INDEX idx_audit_logs_at ON audit_logs (at DESC);
```

#### `notifications` [PDF 5.10, 13]
```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    sent_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_notifications_user_id ON notifications (user_id);
CREATE INDEX idx_notifications_status ON notifications (status);
```

#### `settings` [PDF 5.10]
```sql
CREATE TABLE settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
```

#### `billing_runs` [PDF 5.10, 7.2]
```sql
CREATE TABLE billing_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date DATE NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    finished_at TIMESTAMPTZ NULL,
    created_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT NULL
);

CREATE INDEX idx_billing_runs_run_date ON billing_runs (run_date DESC);
```

---

## 6. Key Indexes Specification [PDF 5.11]
These indexes are strictly required by the design spec and verified for high query throughput:
```sql
-- 1. Unique lookups
CREATE UNIQUE INDEX idx_uq_invoices_number ON invoices (number);
CREATE UNIQUE INDEX idx_uq_subscriptions_number ON subscriptions (number);

-- 2. Automated billing scan index (Daily 00:30 UTC billing run)
CREATE INDEX idx_subscriptions_status_billing_date ON subscriptions (status, next_billing_date);

-- 3. Customer tenant isolation and status lookups
CREATE INDEX idx_subscriptions_customer_id ON subscriptions (customer_id);
CREATE INDEX idx_invoices_customer_id_status ON invoices (customer_id, status);

-- 4. Overdue partial index for dunning queries
CREATE INDEX idx_invoices_overdue_partial ON invoices (status, due_date)
WHERE status = 'confirmed' AND balance > 0;

-- 5. Payments register and invoice history
CREATE INDEX idx_payments_invoice_id ON payments (invoice_id);
CREATE INDEX idx_payments_payment_date ON payments (payment_date);

-- 6. Discount eligibility check index
CREATE INDEX idx_discount_rules_eligibility ON discount_rules (is_active, start_date, end_date);
```

---

## 7. Business Logic Database Constraints & Queries [PDF 7]

### 7.1 Row-Level Locking for Concurrent Billing [PDF 7.2]
Support concurrent batch worker execution via `SKIP LOCKED`:
```sql
SELECT id FROM subscriptions
WHERE status = 'active' AND next_billing_date <= :today
ORDER BY id
FOR UPDATE SKIP LOCKED
LIMIT :batch_size;
```

### 7.2 Atomic Discount Usage Increment [PDF 7.3]
```sql
UPDATE discount_rules
SET usage_count = usage_count + 1
WHERE id = :discount_id
  AND (usage_limit IS NULL OR usage_count < usage_limit);
```

### 7.3 Derived Values & Expressions [PDF 5.9]
- `balance = total - amount_paid` [PDF 5.9].
- Overdue criteria: `status = 'confirmed' AND balance > 0 AND due_date < CURRENT_DATE` [PDF 5.9].

---

## 8. Summary Tables for Reports (Performance Engineering) [PDF 11]
To satisfy the `< 2s` page load budget, summary tables aggregate transaction volume so dashboard reads hundreds of rows rather than scanning millions [PDF 11]:

```sql
CREATE TABLE daily_revenue_summary (
    date DATE PRIMARY KEY,
    total_invoiced NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    total_collected NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    payment_method_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE subscription_snapshot_daily (
    date DATE NOT NULL,
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    active_count INTEGER NOT NULL DEFAULT 0,
    paused_count INTEGER NOT NULL DEFAULT 0,
    closed_count INTEGER NOT NULL DEFAULT 0,
    mrr_contribution NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    PRIMARY KEY (date, plan_id)
);

CREATE INDEX idx_sub_snapshot_date ON subscription_snapshot_daily (date DESC);
```

---

## 9. Seed Data & Performance Verification [PDF 11, 15]
- **Realistic Demo Dataset**:
  - 1 Superadmin user (`admin@brightloop.io`), 2 Staff users, 10 Customers.
  - 4 Products (Service, Software, Addon, Physical), 3 Plans (`monthly`, `yearly`, `weekly`).
  - Standard taxes (e.g. GST 18%), payment terms (`Immediate`, `Net 15`, `Net 30`).
- **High-Volume Performance Dataset**:
  - Script generating 50,000 subscriptions and 500,000 invoices [PDF 11, 15].
  - Run `EXPLAIN ANALYZE` on:
    1. Billing query: `SELECT ... WHERE status='active' AND next_billing_date <= CURRENT_DATE` -> Index Scan on `idx_subscriptions_status_billing_date` (< 10 ms).
    2. Overdue query: `SELECT ... WHERE status='confirmed' AND balance > 0 AND due_date < CURRENT_DATE` -> Index Scan on `idx_invoices_overdue_partial` (< 5 ms).
    3. Customer invoices query: `SELECT ... WHERE customer_id = :id AND status = :status` -> Index Scan on `idx_invoices_customer_id_status` (< 2 ms).

---

## 10. Backup & Disaster Recovery Architecture [PDF 15]
- Automated nightly `pg_dump` with gzip compression and retention policy [PDF 15].
- Continuous archiving with WAL-G / WAL-E to S3-compatible bucket [PDF 15].
- Mandatory test restore script executing periodically in CI to verify database restoration without data loss [PDF 15].

---

## Open Questions & Ambiguities [PDF Rules]
1. **`anchor_day` Column [PDF 7.2 vs 5.6]**: Section 7.2 describes `anchor_day` on the subscription to clamp month-end dates, but Section 5.6 omitted it. Sooraj has incorporated `anchor_day SMALLINT NOT NULL CHECK (anchor_day BETWEEN 1 AND 31)` into the `subscriptions` schema.
2. **`customers.billing_address` Format [PDF 5.2]**: Section 5.2 states `billing_address (JSON or columns)`. The database spec standardizes this as a `JSONB` column to allow flexible international addresses while supporting GIN indexing if needed.
