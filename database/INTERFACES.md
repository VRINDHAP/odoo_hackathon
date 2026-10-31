# Database Interfaces — Subscription Management System (Brightloop)

This document establishes the relational contracts, schema definitions, connection parameters, and performance agreements provided by Sooraj (`/database`) to the Backend and Frontend teams.

---

## 1. Relational Interfaces Provided to Backend (`/backend`)

### 1.1 Connection & Pooling Configuration [PDF 3, 11]
- **Primary Database URI**: `postgresql://brightloop_user:secure_password@postgres:5432/brightloop_db`
- **PgBouncer Pooling URI**: `postgresql://brightloop_user:secure_password@pgbouncer:6432/brightloop_db`
  - Mode: `transaction` pooling.
  - Max client connections: 500.
  - Default pool size: 25.
  - Reserve pool: 5.
- **Read Replica URI**: `postgresql://brightloop_user:secure_password@postgres_replica:5432/brightloop_db` (for reports and snapshots).

### 1.2 Table & Column Schema Mapping for Backend ORM [PDF 5]
Backend models in `backend/app/modules/*/models.py` must align strictly with these exact table names and column types:

| Table Name | Key Columns & Types | Nullability & Constraints | Primary Usage |
| :--- | :--- | :--- | :--- |
| `users` | `id` UUID, `email` VARCHAR(255), `password_hash` VARCHAR(255), `role` user_role, `customer_id` UUID, `is_active` BOOL, `failed_attempts` INT, `locked_until` TIMESTAMPTZ, `last_login_at` TIMESTAMPTZ | `email` UNIQUE (case-insensitive); `role` NOT NULL; `customer_id` FK | Auth & RBAC [PDF 5.1] |
| `password_reset_tokens` | `id` UUID, `user_id` UUID, `token_hash` VARCHAR(64), `expires_at` TIMESTAMPTZ, `used_at` TIMESTAMPTZ, `requested_ip` VARCHAR(45) | `user_id` FK; `token_hash` indexed | Password Reset [PDF 5.1] |
| `refresh_tokens` | `id` UUID, `user_id` UUID, `token_hash` VARCHAR(64), `expires_at` TIMESTAMPTZ, `revoked_at` TIMESTAMPTZ, `device` VARCHAR(255) | `user_id` FK; `token_hash` indexed | Token Rotation [PDF 5.1] |
| `customers` | `id` UUID, `name` VARCHAR(255), `email` VARCHAR(255), `phone` VARCHAR(50), `company_name` VARCHAR(255), `tax_id` VARCHAR(50), `billing_address` JSONB, `status` VARCHAR(50), `deleted_at` TIMESTAMPTZ | `deleted_at` for soft delete [PDF 5, 16] | Customer Profiles [PDF 5.2] |
| `products` | `id` UUID, `name` VARCHAR(255), `type` product_type, `sales_price` NUMERIC(14,2), `cost_price` NUMERIC(14,2), `notes` TEXT, `tax_id` UUID, `is_active` BOOL, `deleted_at` TIMESTAMPTZ | `tax_id` FK to taxes; prices strictly NUMERIC(14,2) | Catalog [PDF 5.3] |
| `product_variants` | `id` UUID, `product_id` UUID, `attribute` VARCHAR(100), `value` VARCHAR(100), `extra_price` NUMERIC(14,2), `is_active` BOOL | `UNIQUE(product_id, attribute, value)` | Product Variants [PDF 5.3] |
| `plans` | `id` UUID, `name` VARCHAR(255), `price` NUMERIC(14,2), `billing_period` billing_period, `min_quantity` INT, `valid_from` DATE, `valid_to` DATE, `auto_close` BOOL, `closable` BOOL, `pausable` BOOL, `renewable` BOOL, `is_active` BOOL | `billing_period` ENUM; boolean behavior flags | Pricing Plans [PDF 5.4] |
| `quotation_templates` | `id` UUID, `name` VARCHAR(255), `validity_days` INT, `plan_id` UUID, `notes` TEXT | `plan_id` FK to plans | Quotation Templates [PDF 5.5] |
| `quotation_template_lines` | `id` UUID, `template_id` UUID, `product_id` UUID, `variant_id` UUID, `quantity` INT, `unit_price` NUMERIC(14,2) | `template_id` FK (CASCADE); `product_id` FK | Template Items [PDF 5.5] |
| `payment_terms` | `id` UUID, `name` VARCHAR(100), `days` INT | Static records: Immediate, Net 15, Net 30 | Contract Terms [PDF 5.6] |
| `subscriptions` | `id` UUID, `number` VARCHAR(50), `customer_id` UUID, `plan_id` UUID, `template_id` UUID, `status` subscription_status, `start_date` DATE, `expiry_date` DATE, `next_billing_date` DATE, `last_billed_through` DATE, `anchor_day` SMALLINT, `payment_term_id` UUID, `quote_valid_until` DATE, `currency` VARCHAR(3), `subtotal` NUMERIC(14,2), `discount_total` NUMERIC(14,2), `tax_total` NUMERIC(14,2), `total` NUMERIC(14,2), `paused_at` TIMESTAMPTZ, `closed_at` TIMESTAMPTZ, `close_reason` TEXT | `number` UNIQUE; `anchor_day` CHECK (1-31) [PDF 7.2]; `customer_id` FK | Subscriptions [PDF 5.6] |
| `subscription_lines` | `id` UUID, `subscription_id` UUID, `product_id` UUID, `variant_id` UUID, `description` VARCHAR(255), `quantity` INT, `unit_price` NUMERIC(14,2), `tax_id` UUID, `discount_id` UUID, `line_subtotal` NUMERIC(14,2), `line_tax` NUMERIC(14,2), `line_total` NUMERIC(14,2) | Snapshot `unit_price` and `tax_id` | Contract Lines [PDF 5.6] |
| `taxes` | `id` UUID, `name` VARCHAR(100), `type` tax_type, `rate` NUMERIC(14,4), `inclusive` BOOL, `applies_to` tax_applies_to, `is_active` BOOL | `rate` is NUMERIC(14,4) | Tax Rules [PDF 5.7] |
| `discount_rules` | `id` UUID, `name` VARCHAR(255), `type` discount_type, `value` NUMERIC(14,2), `min_purchase_amount` NUMERIC(14,2), `min_quantity` INT, `start_date` DATE, `end_date` DATE, `usage_limit` INT, `usage_count` INT, `scope` discount_scope, `is_active` BOOL | `usage_count` incremented via atomic SQL | Discount Rules [PDF 5.8] |
| `discount_products` | `discount_id` UUID, `product_id` UUID | Composite PK (`discount_id`, `product_id`) | Discount Scope [PDF 5.8] |
| `discount_redemptions` | `id` UUID, `discount_id` UUID, `invoice_id` UUID, `subscription_id` UUID, `amount` NUMERIC(14,2), `created_at` TIMESTAMPTZ | `UNIQUE(discount_id, invoice_id)` | Redemptions [PDF 5.8] |
| `invoices` | `id` UUID, `number` VARCHAR(50), `subscription_id` UUID, `customer_id` UUID, `status` invoice_status, `invoice_date` DATE, `due_date` DATE, `period_start` DATE, `period_end` DATE, `currency` VARCHAR(3), `subtotal` NUMERIC(14,2), `discount_total` NUMERIC(14,2), `tax_total` NUMERIC(14,2), `total` NUMERIC(14,2), `amount_paid` NUMERIC(14,2), `balance` NUMERIC(14,2), `sent_at` TIMESTAMPTZ, `pdf_url` VARCHAR(500) | `UNIQUE(subscription_id, period_start, period_end)` (Hard Anti-Double-Billing Guard) [PDF 5.9, 7.2] | Invoices [PDF 5.9] |
| `invoice_lines` | `id` UUID, `invoice_id` UUID, `product_id` UUID, `description` VARCHAR(255), `quantity` INT, `unit_price` NUMERIC(14,2), `discount_amount` NUMERIC(14,2), `tax_id` UUID, `tax_amount` NUMERIC(14,2), `line_total` NUMERIC(14,2) | `invoice_id` FK (CASCADE) | Invoice Lines [PDF 5.9] |
| `payments` | `id` UUID, `invoice_id` UUID, `method` payment_method, `amount` NUMERIC(14,2), `payment_date` TIMESTAMPTZ, `reference` VARCHAR(255), `note` TEXT, `recorded_by` UUID, `status` VARCHAR(50) | `invoice_id` FK; negative amounts allowed for reversals [PDF 7.4] | Payments [PDF 5.9] |
| `audit_logs` | `id` UUID, `actor_id` UUID, `entity` VARCHAR(100), `entity_id` VARCHAR(100), `action` VARCHAR(50), `before_json` JSONB, `after_json` JSONB, `ip` VARCHAR(45), `at` TIMESTAMPTZ | Immutable write-only table | Audit Trail [PDF 5.10] |
| `notifications` | `id` UUID, `user_id` UUID, `type` VARCHAR(100), `payload` JSONB, `status` VARCHAR(50), `sent_at` TIMESTAMPTZ | `user_id` FK; `status` indexed | Notifications [PDF 5.10] |
| `settings` | `key` VARCHAR(100), `value` JSONB, `updated_at` TIMESTAMPTZ | PK is `key` | Settings [PDF 5.10] |
| `billing_runs` | `id` UUID, `run_date` DATE, `started_at` TIMESTAMPTZ, `finished_at` TIMESTAMPTZ, `created_count` INT, `skipped_count` INT, `failed_count` INT, `error_summary` TEXT | Run date indexed | Billing Observability [PDF 5.10] |
| `daily_revenue_summary` | `date` DATE, `total_invoiced` NUMERIC(14,2), `total_collected` NUMERIC(14,2), `payment_method_breakdown` JSONB | PK is `date` | Fast Reporting [PDF 11] |
| `subscription_snapshot_daily` | `date` DATE, `plan_id` UUID, `active_count` INT, `paused_count` INT, `closed_count` INT, `mrr_contribution` NUMERIC(14,2) | Composite PK (`date`, `plan_id`) | Fast Reporting [PDF 11] |

### 1.3 Database Enumeration Types [PDF 5]
```sql
user_role:           'admin', 'staff', 'customer'
product_type:        'service', 'software', 'addon', 'physical'
billing_period:      'daily', 'weekly', 'monthly', 'yearly'
subscription_status: 'draft', 'quotation', 'confirmed', 'active', 'paused', 'closed', 'cancelled'
invoice_status:      'draft', 'confirmed', 'paid', 'cancelled'
payment_method:      'card', 'upi', 'bank_transfer', 'cash', 'cheque', 'other'
tax_type:            'percent', 'fixed'
tax_applies_to:      'all', 'product', 'category'
discount_type:       'percent', 'fixed'
discount_scope:      'product', 'subscription'
```

---

## 2. What Database Demands from Backend (`/backend`)
1. **Never Create or Alter Migrations**: All schema modifications must be requested through Sooraj [PDF Prompt Rules].
2. **Transaction Boundaries**: Single atomic database transaction must wrap all multi-table mutations (e.g. invoice generation + line insertions + discount redemptions + date progressions) [PDF 3, 7.2].
3. **Parameterized Queries**: Backend must NEVER construct raw SQL strings; all repository calls must use parameterized ORM queries to prevent SQL injection vulnerabilities [PDF 9].
4. **Tenant Isolation**: Backend must append `customer_id = :authenticated_customer_id` on all portal queries [PDF 2, 9].
5. **Connection Hygiene**: Backend must release database connections promptly after query execution to prevent pool starvation [PDF 11].
6. **Relational Engine Adherence**: Backend must interact strictly with the relational PostgreSQL 16+ (or MySQL 8+) schema; do NOT introduce or integrate MongoDB, Firebase, or external BaaS layers.

---

## 3. What Database Provides to Frontend (`/frontend`)
1. **Sub-200ms Query Responses**: Fully indexed tables and pre-computed summary tables guarantee that backend API calls return in < 300 ms, ensuring the frontend meets the < 2.0 second page load budget [PDF 1, 11].
2. **Consistent Enums & Field Names**: Exact string enums and column names across all API responses.
