# Backend Specification — Subscription Management System (Brightloop)

## 1. Product Goal and Scope [PDF 1]
- Build a modular monolith REST backend supporting the entire subscription lifecycle: catalog -> quotation -> subscription -> invoice -> payment -> reporting [PDF 1, 3].
- Core Success Guarantees:
  - **No manual invoicing**: Every invoice is generated programmatically from a subscription [PDF 1].
  - **Zero double billing**: Database constraint `UNIQUE(subscription_id, period_start, period_end)` plus per-subscription transactions guarantee idempotent billing [PDF 1, 5.9, 7.2].
  - **Automated taxes and discounts**: Evaluated and applied automatically from admin-defined rules at invoice generation time [PDF 1, 7.1, 7.3].
  - **Payment visibility**: Every payment recorded against the right invoice; paid, outstanding, and overdue calculated accurately [PDF 1, 5.9, 7.4].
  - **Single finance view**: High-performance aggregation endpoints for active subscriptions, MRR/ARR, revenue, overdue invoices [PDF 1, 10].
  - **Performance threshold**: API p95 response time < 300 ms to support overall page load < 2 s with 50,000 subscriptions and 500,000 invoices [PDF 1, 11].

---

## 2. Actors and Access Control (3-Layer RBAC) [PDF 2]
Enforce RBAC across three mandatory defensive layers [PDF 2]:
1. **Layer 1: Route Guards (Role Authorization)**: Intercept all incoming requests at the router/dependency level using JWT claims [PDF 2].
2. **Layer 2: Object-Level Guards**: Verify ownership before read/update (e.g. customer user can only access resources where `customer_id == user.customer_id`) [PDF 2].
3. **Layer 3: DB-Level Query Filtering**: Inject `WHERE customer_id = :authenticated_customer_id` into all repository queries for portal endpoints [PDF 2].

### Backend Capability Matrix [PDF 2]
| Capability | Admin | Internal Staff | Customer (Portal) | Backend Enforcement Policy | Module Owner |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Create staff accounts | Yes | No | No | Endpoint `POST /users/staff` requires `role == 'admin'` [PDF 2, 8] | Nandana |
| Products, variants, plans CRUD | Yes | Read only | Read (own plan) | Write routes require `admin`; read routes allow `staff`; customer can only read assigned plan [PDF 2] | Nandana |
| Taxes, discount rules CRUD | Yes | Read only | No | Writes require `admin`; reads allow `staff`; customer forbidden (HTTP 403) [PDF 2] | Nandana |
| Quotation templates | Yes | Create/use | No | Full CRUD for `admin` and `staff`; customer forbidden [PDF 2] | Nandana |
| Customers CRUD | Yes | Yes | Own profile only | Admin/Staff access full table; customer restricted to `PATCH /me/profile` [PDF 2, 8] | Nandana |
| Subscriptions create/edit/transition | Yes | Yes (no delete) | View own, request cancel/upgrade | Delete blocked for staff; transitions validated via state machine; portal queries filter by `customer_id` [PDF 2, 6.1] | Vrindha |
| Invoices confirm/cancel/send/print | Yes | Yes | View/download own, pay | Admin/Staff full control; portal restricted to own invoices and `POST /me/invoices/{id}/pay` [PDF 2, 8] | Vrindha |
| Record payments | Yes | Yes | Pay own invoices | Admin/Staff can call `POST /invoices/{id}/payments`; portal pays via gateway webhook [PDF 2, 7.4] | Vrindha |
| Reports and dashboard | Yes | Limited (operational) | No | Financial KPIs (MRR/ARR/revenue) require `admin`; operational lists allow `staff`; portal forbidden [PDF 2, 10] | Nandana |
| Audit log, system settings | Yes | No | No | Strictly `admin` only (HTTP 403 for `staff` and `customer`) [PDF 2] | Nandana |

---

## 3. Architecture & Layering Rules [PDF 3]
- **Modular Monolith**: Run as a single deployable service with distinct domain modules [PDF 3].
- **Relational SQL Database Mandate**: All application data must persist exclusively in a relational SQL database: PostgreSQL 16+ (or MySQL 8+) [PDF 3, 5].
  - Multi-table financial consistency (invoices + discount redemptions + subscription date progression) requires atomic relational ACID transactions [PDF 3, 7.2].
  - NoSQL and BaaS platforms (MongoDB, Firebase Firestore, Firebase Realtime Database, CouchDB, DynamoDB, Supabase) are strictly prohibited.
- **Minimal Third-Party API Footprint**:
  - Auth is implemented natively via argon2id and JWT; external auth SaaS (Firebase Auth, Clerk, Auth0) is forbidden [PDF 9].
  - Invoice PDF generation is executed locally via native Python libraries (WeasyPrint / ReportLab) rather than external cloud PDF APIs [PDF 3, 11].
  - Storage supports local disk or containerized MinIO alongside S3, eliminating mandatory AWS cloud credentials [PDF 3].
  - Payment processing abstracts the gateway via `PaymentProvider`, providing a `SimulatedPaymentProvider` for full offline hackathon judging alongside Razorpay/Stripe [PDF 7.4].
  - Email dispatching supports local SMTP / MailHog container without requiring paid third-party email APIs (SendGrid/Mailgun) [PDF 13].
- **Single Transaction Boundary**: Multi-table state changes must commit atomically within one database transaction (e.g. invoice creation + discount redemption record + discount usage increment + subscription billing dates update) [PDF 3, 7.2].
- **Module Internal Layering**:
  `router.py` (HTTP serialization, status codes) ->
  `service.py` (pure business logic, validation, audit dispatch) ->
  `repository.py` (SQLAlchemy / raw SQL queries, parameterized) ->
  `models.py` (ORM domain entities) [PDF 3, 14].
- **Strict Rule**: No business logic (pricing, discounts, transitions, dates) allowed in routers [PDF 3].

---

## 4. Module Breakdown & Responsibilities [PDF 4]
1. `auth` & `users` [Nandana]: JWT tokens (access 15m, refresh 7d), password policy, argon2id/bcrypt cost 12, lockout, last admin protection [PDF 4, 5.1, 9].
2. `customers` [Nandana]: Profile, tax ID, billing address, tenant association [PDF 4, 5.2].
3. `catalog` [Nandana]: Products, variants, cost vs sales pricing, admin margin calculation [PDF 4, 5.3].
4. `plans` [Nandana]: Plan parameters, interval logic, behavior flags [PDF 4, 5.4].
5. `templates` [Nandana]: Quotation templates, pre-filled items, one-click quote factory [PDF 4, 5.5].
6. `subscriptions` [Vrindha]: Contract numbers (`SUB-YYYY-NNNNNN`), lines snapshotting, central state machine [PDF 4, 5.6, 6.1].
7. `taxes` [Nandana]: Admin tax rules, rate calculation (inclusive vs exclusive) [PDF 4, 5.7, 7.1].
8. `discounts` [Nandana]: Discount rules, concurrency-safe counter, eligibility engine [PDF 4, 5.8, 7.3].
9. `invoices` & `billing` [Vrindha]: Daily billing job, idempotency guard, numbering, status transitions [PDF 4, 5.9, 6.2, 7.2].
10. `payments` [Vrindha]: Payment records, invoice allocation, balance recomputation, gateway webhook [PDF 4, 5.9, 7.4].
11. `reports` [Nandana]: Summary KPIs, MRR normalization, summary table readers, CSV streaming [PDF 4, 10, 11].
12. `notifications`, `audit` & `jobs` [Nandana / Vrindha]: Email queue with backoff, audit trail, background schedulers [PDF 4, 5.10, 13].

---

## 5. Low-Level Data Models & Type Specifications [PDF 5]
Conventions: UUID or bigint PKs; `created_at`, `updated_at`, `created_by`; soft delete via `deleted_at`; monetary amounts strictly `NUMERIC(14,2)` (never float); document currency code stored on documents; all foreign keys indexed [PDF 5].

### 5.1 Identity [Nandana] [PDF 5.1]
- `users`: `id` (PK), `email` (VARCHAR, UNIQUE, stored lowercase), `password_hash` (VARCHAR, argon2id or bcrypt cost 12), `role` (ENUM: `admin`, `staff`, `customer`), `customer_id` (FK to customers, nullable), `is_active` (BOOL, default true), `failed_attempts` (INT, default 0), `locked_until` (TIMESTAMPTZ, nullable), `last_login_at` (TIMESTAMPTZ, nullable) [PDF 5.1, 9].
- `password_reset_tokens`: `id` (PK), `user_id` (FK), `token_hash` (VARCHAR, store SHA-256 hash, not plain token), `expires_at` (TIMESTAMPTZ, 30 min expiry), `used_at` (TIMESTAMPTZ, nullable), `requested_ip` (VARCHAR) [PDF 5.1, 9].
- `refresh_tokens`: `id` (PK), `user_id` (FK), `token_hash` (VARCHAR), `expires_at` (TIMESTAMPTZ, 7 days), `revoked_at` (TIMESTAMPTZ, nullable), `device` (VARCHAR) [PDF 5.1, 9].

### 5.2 Customers [Nandana] [PDF 5.2]
- `customers`: `id` (PK), `name` (VARCHAR), `email` (VARCHAR), `phone` (VARCHAR), `company_name` (VARCHAR), `tax_id` (VARCHAR), `billing_address` (JSON/columns), `status` (VARCHAR, default 'active'), `deleted_at` (TIMESTAMPTZ, nullable for soft delete) [PDF 5.2, 16].

### 5.3 Catalog [Nandana] [PDF 5.3]
- `products`: `id` (PK), `name` (VARCHAR), `type` (ENUM: `service`, `software`, `addon`, `physical`), `sales_price` (NUMERIC(14,2)), `cost_price` (NUMERIC(14,2)), `notes` (TEXT), `tax_id` (FK to taxes, nullable default tax), `is_active` (BOOL, default true) [PDF 5.3].
- `product_variants`: `id` (PK), `product_id` (FK), `attribute` (VARCHAR, e.g. 'Brand'), `value` (VARCHAR, e.g. 'Odoo'), `extra_price` (NUMERIC(14,2)), `is_active` (BOOL, default true). Constraint: `UNIQUE(product_id, attribute, value)` [PDF 5.3].
- Effective unit price formula: `product.sales_price + variant.extra_price` [PDF 5.3].
- Margin formula: `sales_price - cost_price` (visible to Admin only) [PDF 5.3].

### 5.4 Plans [Nandana] [PDF 5.4]
- `plans`: `id` (PK), `name` (VARCHAR), `price` (NUMERIC(14,2)), `billing_period` (ENUM: `daily`, `weekly`, `monthly`, `yearly`), `min_quantity` (INT, default 1), `valid_from` (DATE), `valid_to` (DATE), `auto_close` (BOOL), `closable` (BOOL), `pausable` (BOOL), `renewable` (BOOL), `is_active` (BOOL, default true) [PDF 5.4].

### 5.5 Quotation Templates [Nandana] [PDF 5.5]
- `quotation_templates`: `id` (PK), `name` (VARCHAR), `validity_days` (INT), `plan_id` (FK), `notes` (TEXT) [PDF 5.5].
- `quotation_template_lines`: `id` (PK), `template_id` (FK), `product_id` (FK), `variant_id` (FK, nullable), `quantity` (INT), `unit_price` (NUMERIC(14,2)) [PDF 5.5].

### 5.6 Subscriptions [Vrindha] [PDF 5.6]
- `subscriptions`: `id` (PK), `number` (VARCHAR, UNIQUE, e.g. `SUB-2026-000123` from DB sequence), `customer_id` (FK), `plan_id` (FK), `template_id` (FK, nullable), `status` (ENUM: `draft`, `quotation`, `confirmed`, `active`, `paused`, `closed`, `cancelled`), `start_date` (DATE), `expiry_date` (DATE), `next_billing_date` (DATE), `last_billed_through` (DATE), `payment_term_id` (FK), `quote_valid_until` (DATE), `subtotal` (NUMERIC(14,2)), `discount_total` (NUMERIC(14,2)), `tax_total` (NUMERIC(14,2)), `total` (NUMERIC(14,2)), `paused_at` (TIMESTAMPTZ, nullable), `closed_at` (TIMESTAMPTZ, nullable), `close_reason` (TEXT, nullable), `anchor_day` (SMALLINT, 1-31, for billing clamp stabilization [PDF 7.2]) [PDF 5.6].
- `subscription_lines`: `id` (PK), `subscription_id` (FK), `product_id` (FK), `variant_id` (FK, nullable), `description` (VARCHAR), `quantity` (INT), `unit_price` (NUMERIC(14,2) snapshot), `tax_id` (FK, nullable), `discount_id` (FK, nullable), `line_subtotal` (NUMERIC(14,2)), `line_tax` (NUMERIC(14,2)), `line_total` (NUMERIC(14,2)) [PDF 5.6].
- `payment_terms`: `id` (PK), `name` (VARCHAR, e.g. `Immediate`, `Net 15`, `Net 30`), `days` (INT) [PDF 5.6].

### 5.7 Taxes [Nandana] [PDF 5.7]
- `taxes`: `id` (PK), `name` (VARCHAR, e.g. 'GST 18%'), `type` (ENUM: `percent`, `fixed`), `rate` (NUMERIC(14,4)), `inclusive` (BOOL), `applies_to` (ENUM: `all`, `product`, `category`), `is_active` (BOOL, default true) [PDF 5.7].

### 5.8 Discounts [Nandana] [PDF 5.8]
- `discount_rules`: `id` (PK), `name` (VARCHAR), `type` (ENUM: `percent`, `fixed`), `value` (NUMERIC(14,2)), `min_purchase_amount` (NUMERIC(14,2), default 0), `min_quantity` (INT, default 0), `start_date` (DATE), `end_date` (DATE), `usage_limit` (INT, nullable), `usage_count` (INT, default 0), `scope` (ENUM: `product`, `subscription`), `is_active` (BOOL, default true) [PDF 5.8].
- `discount_products`: `discount_id` (FK), `product_id` (FK), PK(`discount_id`, `product_id`) [PDF 5.8].
- `discount_redemptions`: `id` (PK), `discount_id` (FK), `invoice_id` (FK), `subscription_id` (FK), `amount` (NUMERIC(14,2)), `created_at` (TIMESTAMPTZ). Constraint: `UNIQUE(discount_id, invoice_id)` [PDF 5.8].

### 5.9 Invoices & Payments [Vrindha] [PDF 5.9]
- `invoices`: `id` (PK), `number` (VARCHAR, UNIQUE sequence), `subscription_id` (FK), `customer_id` (FK), `status` (ENUM: `draft`, `confirmed`, `paid`, `cancelled`), `invoice_date` (DATE), `due_date` (DATE), `period_start` (DATE), `period_end` (DATE), `subtotal` (NUMERIC(14,2)), `discount_total` (NUMERIC(14,2)), `tax_total` (NUMERIC(14,2)), `total` (NUMERIC(14,2)), `amount_paid` (NUMERIC(14,2), default 0.00), `balance` (NUMERIC(14,2)), `sent_at` (TIMESTAMPTZ, nullable), `pdf_url` (VARCHAR, nullable) [PDF 5.9].
  - Anti-Double-Billing Constraint: `UNIQUE(subscription_id, period_start, period_end)` [PDF 5.9].
- `invoice_lines`: `id` (PK), `invoice_id` (FK), `product_id` (FK), `description` (VARCHAR), `quantity` (INT), `unit_price` (NUMERIC(14,2)), `discount_amount` (NUMERIC(14,2)), `tax_id` (FK, nullable), `tax_amount` (NUMERIC(14,2)), `line_total` (NUMERIC(14,2)) [PDF 5.9].
- `payments`: `id` (PK), `invoice_id` (FK), `method` (ENUM: `card`, `upi`, `bank_transfer`, `cash`, `cheque`, `other`), `amount` (NUMERIC(14,2)), `payment_date` (TIMESTAMPTZ), `reference` (VARCHAR), `note` (TEXT), `recorded_by` (FK to users), `status` (VARCHAR, default 'completed') [PDF 5.9].
  - Derived values: `balance = total - amount_paid` [PDF 5.9].
  - Overdue condition: `status == 'confirmed' AND balance > 0 AND due_date < CURRENT_DATE` [PDF 5.9].

### 5.10 Support Tables [Nandana / Vrindha] [PDF 5.10]
- `audit_logs` [Nandana]: `id` (PK), `actor_id` (FK to users), `entity` (VARCHAR), `entity_id` (VARCHAR), `action` (VARCHAR), `before_json` (JSONB), `after_json` (JSONB), `ip` (VARCHAR), `at` (TIMESTAMPTZ default now) [PDF 5.10].
- `notifications` [Vrindha]: `id` (PK), `user_id` (FK), `type` (VARCHAR), `payload` (JSONB), `status` (VARCHAR), `sent_at` (TIMESTAMPTZ) [PDF 5.10].
- `settings` [Nandana]: `key` (VARCHAR, PK), `value` (JSONB) [PDF 5.10].
- `billing_runs` [Vrindha]: `id` (PK), `run_date` (DATE), `started_at` (TIMESTAMPTZ), `finished_at` (TIMESTAMPTZ), `created_count` (INT), `skipped_count` (INT), `failed_count` (INT), `error_summary` (TEXT) [PDF 5.10].

---

## 6. State Machines [Vrindha] [PDF 6]

### 6.1 Subscription State Machine [PDF 6.1]
```text
Draft -> Quotation -> Confirmed -> Active -> Closed
  |         |            |           |  ^
  |         |            |           v  |
  |         |            |         Paused
  +---------+------------+-------> Cancelled (before Active)
```
- Core Transition Function: `transition(subscription, target_status, actor)` [PDF 6.1].
- Rejection Rule: Any invalid transition must raise an exception returning HTTP 409 Conflict [PDF 6.1].
- Audit Requirement: Successful transition writes an entry to `audit_logs` and emits internal event [PDF 6.1].

#### Allowed Transition Rules [PDF 6.1]
1. `Draft` -> `Quotation`: Actor: Staff/Admin. Rule: Must have valid `customer_id`, valid `plan_id`, at least one line item, and all line quantities >= `plan.min_quantity` [PDF 6.1].
2. `Quotation` -> `Confirmed`: Actor: Staff/Admin or Customer accepting in portal. Rule: Current date must be <= `quote_valid_until` [PDF 6.1].
3. `Confirmed` -> `Active`: Actor: System or Staff. Rule: Start date reached or manual activation; initializes `next_billing_date = start_date` [PDF 6.1].
4. `Active` -> `Paused`: Actor: Staff/Admin. Rule: Allowed ONLY IF `plan.pausable == true`. Paused subscriptions are skipped during billing runs [PDF 5.4, 6.1]. Sets `paused_at = now()`.
5. `Paused` -> `Active`: Actor: Staff/Admin. Rule: Resumes subscription and recomputes `next_billing_date` based on remaining unbilled interval [PDF 6.1, 7.2]. Clears `paused_at`.
6. `Active` -> `Closed`: Actor: Staff/Admin or System (auto-close job). Rule: Allowed if `plan.closable == true` or automatically at `expiry_date` if `plan.auto_close == true`. Sets `closed_at = now()`, requires `close_reason` [PDF 5.4, 6.1].
7. `Closed` -> `Active` (Renewal): Actor: Staff/Admin. Rule: Allowed ONLY IF `plan.renewable == true`. Creates a new term [PDF 5.4, 6.1].
8. `Draft` / `Quotation` / `Confirmed` -> `Cancelled`: Actor: Staff/Admin. Allowed strictly before subscription enters `Active` status [PDF 6.1].

### 6.2 Invoice State Machine [PDF 6.2]
```text
Draft -> Confirmed -> Paid
  |          |
  +-> Cancelled <-+ (Paid cannot be cancelled; use credit note)
```
- Transition Rules:
  - `Draft` -> `Confirmed`: Validated and published by Staff/Admin [PDF 6.2].
  - `Confirmed` -> `Paid`: Set automatically when `amount_paid >= total`. No manual override to Paid [PDF 6.2].
  - `Draft` -> `Cancelled` OR `Confirmed` -> `Cancelled`: Staff/Admin action. Reverses any discount redemptions, decrementing `usage_count` [PDF 6.2, 7.3].
  - `Paid` -> `Cancelled`: **Strictly Forbidden**. System must return HTTP 409 Conflict with message: *"Paid invoices cannot be cancelled; use credit note"* [PDF 6.2, 18].
  - Actions (not states): `send` (records `sent_at`), `print` / `pdf` (fetches rendered document) [PDF 6.2].

---

## 7. Core Business Logic Algorithms [Nandana & Vrindha] [PDF 7]

### 7.1 Pricing a Subscription Line [Nandana] [PDF 7.1]
Execute in exact 5-step sequence:
1. `unit_price = product.sales_price + variant.extra_price` (can be overridden by staff in `Draft` status) [PDF 7.1].
2. `line_subtotal = quantity * unit_price` [PDF 7.1].
3. Apply eligible discount to obtain `taxable_amount`:
   - `taxable_amount = line_subtotal - line_discount` [PDF 7.1, 7.3].
4. Apply tax rate:
   - If exclusive: `exclusive_tax = taxable_amount * rate` [PDF 7.1].
   - If inclusive: `inclusive_tax = taxable_amount - (taxable_amount / (1 + rate))` [PDF 7.1].
5. Round all line-level amounts to 2 decimal places using standard **half-up rounding** (`ROUND_HALF_UP`) [PDF 7.1].
6. Document totals: Sum rounded line values for `subtotal`, `discount_total`, `tax_total`, and `total` so document total strictly equals the sum of line totals [PDF 7.1].

### 7.2 Automated Billing Engine (`run_billing`) [Vrindha] [PDF 7.2]
- Schedule: Runs daily at 00:30 UTC via Celery/Redis beat, and triggerable manually by Admin via `POST /billing/run` [PDF 7.2, 13].
- Algorithm Execution:
```python
def run_billing(today):
    # Lock eligible active subscriptions using SKIP LOCKED for worker concurrency
    due_subs = db.query(Subscription).filter(
        Subscription.status == 'Active',
        Subscription.next_billing_date <= today
    ).order_by(Subscription.id).with_for_update(skip_locked=True).limit(BATCH_SIZE).all()

    created_count = 0
    skipped_count = 0
    failed_count = 0

    for sub in due_subs:
        try:
            with db.begin_nested(): # Per-subscription transaction boundary
                period_start = sub.next_billing_date
                period_end = calculate_next_period_end(period_start, sub.plan.billing_period, sub.anchor_day)

                # 1. Idempotency check: Guard against duplicate run
                existing = db.query(Invoice).filter_by(
                    subscription_id=sub.id,
                    period_start=period_start,
                    period_end=period_end
                ).first()
                if existing:
                    skipped_count += 1
                    continue

                # 2. Build invoice, lines, taxes, and discounts
                invoice = build_invoice(sub, period_start, period_end)
                db.add(invoice)
                db.flush()

                # 3. Record discount redemption and increment usage count
                for redemption in invoice.redemptions:
                    db.add(redemption)
                    db.execute(
                        update(DiscountRule)
                        .where(DiscountRule.id == redemption.discount_id)
                        .where(or_(DiscountRule.usage_limit.is_(None), DiscountRule.usage_count < DiscountRule.usage_limit))
                        .values(usage_count=DiscountRule.usage_count + 1)
                    )

                # 4. Advance subscription billing dates
                sub.next_billing_date = period_end
                sub.last_billed_through = period_end

                # 5. Check expiry
                if sub.expiry_date and sub.expiry_date < sub.next_billing_date:
                    if sub.plan.auto_close:
                        sub.status = 'Closed'
                        sub.closed_at = datetime.utcnow()
                        sub.close_reason = 'Plan expired (auto-close)'

                db.commit()
                created_count += 1
        except Exception as e:
            db.rollback()
            failed_count += 1
            log_billing_error(sub.id, str(e))

    record_billing_run_summary(today, created_count, skipped_count, failed_count)
```
- Billing Date Arithmetic Rules:
  - `daily`: `+1 day` [PDF 7.2].
  - `weekly`: `+7 days` [PDF 7.2].
  - `monthly`: Calendar month-end clamping (e.g. Jan 31 -> Feb 28/29). Store and use `anchor_day` (e.g. 31) so March billing resumes on Mar 31 and does not permanently drift to day 28 [PDF 7.2].
  - `yearly`: Handles leap years (Feb 29 -> Feb 28 on non-leap years) [PDF 7.2].
- Never Missed Guarantee: Because query selects `next_billing_date <= today`, any missed runs are caught up sequentially in order [PDF 7.2].

### 7.3 Discount Engine [Nandana] [PDF 7.3]
- Evaluation Point: Discount eligibility is evaluated dynamically at invoice build time [PDF 7.3].
- Eligibility Predicate:
  ```sql
  is_active = TRUE
  AND start_date <= invoice_date AND invoice_date <= end_date
  AND (usage_limit IS NULL OR usage_count < usage_limit)
  AND subtotal >= min_purchase_amount
  AND total_quantity >= min_quantity
  AND (scope = 'subscription' OR product_id IN (SELECT product_id FROM discount_products WHERE discount_id = discount_rules.id))
  ```
- Calculation Rules:
  - Percent: `subtotal * value / 100` [PDF 7.3].
  - Fixed: `min(value, subtotal)` (result never negative) [PDF 7.3].
  - Best Single Discount Rule: If multiple discounts qualify, apply the single discount providing the largest price deduction by default (configurable stacking) [PDF 7.3].
- Concurrency Safety:
  `UPDATE discount_rules SET usage_count = usage_count + 1 WHERE id = :id AND (usage_limit IS NULL OR usage_count < usage_limit)` [PDF 7.3].
- Cancellation Release: If an unpaid invoice is cancelled, delete `discount_redemptions` and decrement `discount_rules.usage_count = usage_count - 1` [PDF 7.3, 16].

### 7.4 Payments Engine [Vrindha] [PDF 7.4]
- 1:1 Invariant: A payment is attached to exactly one invoice [PDF 7.4].
- Partial Payments: Allowed; recomputes `amount_paid` and `balance` [PDF 7.4].
- Overpayment Blocking: Reject payment if `amount > invoice.balance` with HTTP 422 Unprocessable Entity (unless store credit enabled) [PDF 7.4].
- Atomic Execution: On payment insertion within a single transaction:
  1. Insert row into `payments` table [PDF 7.4].
  2. Recompute invoice `amount_paid = SUM(payments.amount)` and `balance = total - amount_paid` [PDF 5.9, 7.4].
  3. If `balance == 0`, transition invoice `status = 'Paid'` [PDF 6.2, 7.4].
  4. Write `audit_logs` record [PDF 7.4, 9].
  5. Enqueue payment receipt email job [PDF 7.4, 13].
- Append-Only Rule: Payments cannot be edited or deleted. Corrections must be entered as separate negative reversal entries (`amount < 0`) with mandatory reason text [PDF 7.4].
- Online Gateway Integration: `PaymentProvider` abstract interface implementing:
  - `RazorpayPaymentProvider` & `StripePaymentProvider`: Production webhook verification and signature checking [PDF 7.4].
  - `SimulatedPaymentProvider` (Hackathon Offline Sandbox): Native self-contained provider generating instant test checkouts and firing simulated webhook events, ensuring evaluation requires zero external third-party credentials or network dependencies [PDF 7.4].
  - Idempotency enforced via gateway transaction ID [PDF 7.4].

### 7.5 Overdue & Dunning Engine [Vrindha] [PDF 7.5]
- Daily Job: Identifies invoices where `status == 'confirmed' AND balance > 0 AND due_date < today` [PDF 5.9, 7.5].
- Reminder Schedule: Send automated reminders at `due_date - 3 days`, `due_date`, `due_date + 3 days`, `due_date + 7 days`, `due_date + 14 days` [PDF 7.5].
- Aging Buckets Query: Aggregate overdue amounts into `0-30`, `31-60`, `61-90`, and `90+` days past due [PDF 7.5, 10].

---

## 8. REST API Specification (/api/v1) [PDF 8]
All endpoints prefixed with `/api/v1`. Enforce JSON serialization, standard pagination (`page`, `page_size`), query filters, and consistent error schema `{ "code": string, "message": string, "fields": [] }` [PDF 8].

### Endpoints Table & Ownership [PDF 8]
| Module | Method & Route | Access Level | Description | Owner |
| :--- | :--- | :--- | :--- | :--- |
| Auth | `POST /auth/signup` | Public | Register new customer account [PDF 8] | Nandana |
| Auth | `POST /auth/login` | Public | Authenticate user, return JWT + refresh token [PDF 8] | Nandana |
| Auth | `POST /auth/refresh` | Public | Exchange refresh token for new access token [PDF 8] | Nandana |
| Auth | `POST /auth/logout` | Authenticated | Revoke active refresh token [PDF 8] | Nandana |
| Auth | `POST /auth/forgot-password` | Public | Issue 30-min password reset token [PDF 8, 9] | Nandana |
| Auth | `POST /auth/reset-password` | Public | Reset password with token, revoke all sessions [PDF 8, 9] | Nandana |
| Users | `POST /users/staff` | Admin | Create internal staff account [PDF 2, 8] | Nandana |
| Customers | `GET /customers`, `POST /customers` | Admin/Staff | List paginated customers / create customer [PDF 8] | Nandana |
| Customers | `GET /customers/{id}`, `PATCH /customers/{id}` | Admin/Staff | Get / update customer details [PDF 8] | Nandana |
| Products | `GET /products`, `POST /products` | Staff (R) / Admin (W) | List products / create product [PDF 8] | Nandana |
| Products | `GET /products/{id}`, `PATCH`, `DELETE` | Staff (R) / Admin (W) | Manage product by ID [PDF 8] | Nandana |
| Products | `POST /products/{id}/variants` | Admin | Add variant with `extra_price` [PDF 5.3, 8] | Nandana |
| Plans | `GET /plans`, `POST /plans` | Staff (R) / Admin (W) | List plans / create plan [PDF 8] | Nandana |
| Plans | `PATCH /plans/{id}` | Admin | Update plan details / flags [PDF 5.4, 8] | Nandana |
| Templates | `GET /quotation-templates`, `POST` | Admin/Staff | List / create quotation templates [PDF 8] | Nandana |
| Templates | `POST /quotation-templates/{id}/create-quotation` | Admin/Staff | Generate subscription draft from template [PDF 5.5, 8] | Nandana |
| Subscriptions | `GET /subscriptions`, `POST /subscriptions` | Admin/Staff | List subscriptions / create draft [PDF 8] | Vrindha |
| Subscriptions | `GET /subscriptions/{id}`, `PATCH /subscriptions/{id}` | Admin/Staff | Fetch detail / update lines in draft [PDF 8] | Vrindha |
| Subscriptions | `POST /subscriptions/{id}/transition` | Admin/Staff/Portal | Trigger state transition (body: `{ target }`) [PDF 6.1, 8] | Vrindha |
| Subscriptions | `POST /subscriptions/{id}/pause` | Admin/Staff | Pause active subscription [PDF 8] | Vrindha |
| Subscriptions | `POST /subscriptions/{id}/resume` | Admin/Staff | Resume paused subscription [PDF 8] | Vrindha |
| Subscriptions | `POST /subscriptions/{id}/close` | Admin/Staff | Close subscription with reason [PDF 8] | Vrindha |
| Subscriptions | `POST /subscriptions/{id}/renew` | Admin/Staff | Renew closed subscription [PDF 8] | Vrindha |
| Taxes | `GET /taxes`, `POST /taxes`, `PATCH /taxes` | Staff (R) / Admin (W) | Manage tax rules [PDF 8] | Nandana |
| Discounts | `GET /discounts`, `POST`, `PATCH` | Staff (R) / Admin (W) | Manage discount rules [PDF 8] | Nandana |
| Discounts | `GET /discounts/{id}/usage` | Admin/Staff | Get redemption history and usage count [PDF 8] | Nandana |
| Invoices | `GET /invoices`, `GET /invoices/{id}` | Admin/Staff | List invoices / get invoice document [PDF 8] | Vrindha |
| Invoices | `POST /invoices/{id}/confirm` | Admin/Staff | Confirm draft invoice [PDF 6.2, 8] | Vrindha |
| Invoices | `POST /invoices/{id}/cancel` | Admin/Staff | Cancel draft/confirmed invoice [PDF 6.2, 8] | Vrindha |
| Invoices | `POST /invoices/{id}/send` | Admin/Staff | Email invoice PDF to customer [PDF 6.2, 8] | Vrindha |
| Invoices | `GET /invoices/{id}/pdf` | Admin/Staff/Portal | Stream generated PDF document [PDF 8, 11] | Vrindha |
| Billing | `POST /billing/run` | Admin | Manually trigger billing run job [PDF 7.2, 8] | Vrindha |
| Payments | `GET /payments` | Admin/Staff | List recorded payments (?format=csv) [PDF 8, 10] | Vrindha |
| Payments | `POST /invoices/{id}/payments` | Admin/Staff | Record payment against invoice (Idempotency-Key) [PDF 7.4, 8] | Vrindha |
| Reports | `GET /reports/summary` | Admin/Staff (limited) | Executive KPI summary [PDF 10] | Nandana |
| Reports | `GET /reports/active-subscriptions` | Admin/Staff | Active subs list (?format=csv) [PDF 8, 10] | Nandana |
| Reports | `GET /reports/revenue` | Admin | Revenue by month, plan, product (?format=csv) [PDF 8, 10] | Nandana |
| Reports | `GET /reports/outstanding` | Admin/Staff | Outstanding invoices (?format=csv) [PDF 8, 10] | Nandana |
| Reports | `GET /reports/overdue` | Admin/Staff | Overdue aging report (?format=csv) [PDF 8, 10] | Nandana |
| Reports | `GET /reports/payments` | Admin/Staff | Payment register (?format=csv) [PDF 8, 10] | Nandana |
| Portal | `GET /me/subscriptions` | Customer | Get caller's own subscriptions [PDF 8, 9] | Vrindha |
| Portal | `GET /me/invoices` | Customer | Get caller's own invoices [PDF 8, 9] | Vrindha |
| Portal | `GET /me/payments` | Customer | Get caller's own payment history [PDF 8, 9] | Vrindha |
| Portal | `POST /me/invoices/{id}/pay` | Customer | Initiate online gateway checkout [PDF 7.4, 8] | Vrindha |
| Portal | `PATCH /me/profile` | Customer | Update own profile / billing address [PDF 8, 9] | Nandana |

---

## 9. Authentication & Security Engine [Nandana] [PDF 9]
- **Password Hashing**: argon2id with recommended memory/time parameters or bcrypt cost factor 12. Password hashes never returned in responses or logged [PDF 9].
- **Password Strength Regex**: Enforce on both client and server:
  `^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$` [PDF 8, 9].
- **Token Security**:
  - Access Token: JWT signed with asymmetric key (RS256) or HMAC-SHA256, 15-minute lifespan [PDF 9].
  - Refresh Token: 7-day lifespan, cryptographically random, stored as SHA-256 hash in database, rotating on use, revocable [PDF 5.1, 9].
- **Password Reset Flow**:
  - Constant response: *"If the email exists, a link was sent"* to eliminate account enumeration [PDF 9].
  - Token: 256-bit entropy, stored hashed, single-use, 30-minute expiry [PDF 9].
  - On successful password reset: revoke all active refresh tokens for user [PDF 9].
- **Brute-Force Protection**: Rate limiting on `/auth/login`, `/auth/signup`, and `/auth/reset-password`; lock account (`locked_until = now() + 15 min`) after 5 failed attempts [PDF 5.1, 9].
- **Admin Demotion Guard**: Business rule prohibits demoting or deleting the last active Administrator account [PDF 9].
- **Audit Logging**: Interceptor automatically records actor ID, entity name, entity ID, action, before JSON, after JSON, IP address, and timestamp for all money-affecting actions (pricing edits, invoice state changes, payment insertions, discount edits, role assignments) [PDF 9].
- **Customer Isolation Rule**: Every portal query must filter by `customer_id == user.customer_id`. Automated tests must assert cross-tenant access returns 403 Forbidden [PDF 9].

---

## 10. Reporting and Finance Calculations [Nandana] [PDF 10]
- **MRR Normalization Formula**:
  ```text
  MRR = SUM(
    CASE plan.billing_period
      WHEN 'monthly' THEN subtotal * 1.0
      WHEN 'yearly'  THEN subtotal / 12.0
      WHEN 'weekly'  THEN subtotal * (52.0 / 12.0)
      WHEN 'daily'   THEN subtotal * (365.0 / 12.0)
    END
  )
  FOR ALL subscriptions WHERE status = 'Active' (Paused subscriptions strictly excluded)
  ``` [PDF 10].
- **ARR Formula**: `ARR = MRR * 12.0` [PDF 10].
- **Summary Metrics**:
  - `revenue_collected`: `SUM(payments.amount)` for selected period [PDF 10].
  - `total_invoiced`: `SUM(invoices.total)` for selected period [PDF 10].
  - `outstanding_amount`: `SUM(invoices.balance)` for invoices where `status == 'confirmed'` [PDF 10].
  - `overdue_amount`: `SUM(invoices.balance)` where `status == 'confirmed' AND due_date < today` [PDF 10].
  - `new_vs_closed`: Count of subscriptions activated vs closed within date range [PDF 10].

---

## 11. Performance Engineering & Budgets [Nandana & Vrindha] [PDF 11]
- **Latency Budget**: API p95 < 300 ms across all endpoints under 50,000 subscriptions and 500,000 invoices [PDF 11].
- **Pagination**: Server-side pagination enforced on all collection endpoints; keyset (cursor) pagination available for heavy tables (`invoices`, `subscriptions`, `audit_logs`) [PDF 11].
- **Query Optimization**: Strict eager loading of related lines and customers; forbid N+1 query patterns; select only required columns [PDF 11].
- **Summary Tables**: Read from pre-aggregated summary tables `daily_revenue_summary` and `subscription_snapshot_daily` for dashboard requests rather than aggregating raw millions of rows [PDF 11].
- **Redis Caching**: Cache dashboard summary KPIs with 1-5 minute TTL; invalidate on payment recording or billing run completion [PDF 11].
- **Request Path Offloading**: PDF generation, email dispatching, billing runs, and CSV exports must run asynchronously in worker processes [PDF 11].

---

## 12. Support for Frontend Screens [Nandana & Vrindha] [PDF 12]
- Support all screens specified in Section 12 with required payload schemas, inline error messages, and CORS headers [PDF 12].

---

## 13. Background Jobs & Notifications Engine [Vrindha] [PDF 13]

### Scheduled Cron Jobs Table [PDF 13]
| Job Name | Schedule | Action Performed | Implementation File |
| :--- | :--- | :--- | :--- |
| `billing_run` | Daily 00:30 UTC | Query due active subscriptions (`next_billing_date <= today`) and generate invoices | `app/jobs/billing_run.py` [PDF 13] |
| `activation` | Daily 00:00 UTC | Transition `Confirmed -> Active` for subscriptions reaching `start_date` | `app/jobs/renewals.py` [PDF 13] |
| `auto_close` | Daily 01:00 UTC | Transition `Active -> Closed` for subscriptions past `expiry_date` on `auto_close` plans | `app/jobs/renewals.py` [PDF 13] |
| `renewal_reminders` | Daily 08:00 UTC | Email customers N days before expiry; flag renewable subscriptions for staff review | `app/jobs/renewals.py` [PDF 13] |
| `overdue_dunning` | Daily 09:00 UTC | Refresh overdue aging buckets; dispatch reminder emails on schedule (due -3, 0, +3, +7, +14) | `app/jobs/dunning.py` [PDF 13] |
| `quote_expiry` | Daily 02:00 UTC | Mark quotations past validity date as expired / cancelled | `app/jobs/renewals.py` [PDF 13] |
| `report_snapshots` | Hourly & Daily | Refresh `daily_revenue_summary` and `subscription_snapshot_daily` summary tables | `app/jobs/snapshots.py` [PDF 13] |
| `email_queue` | Continuous Worker | Dequeue email tasks, dispatch via SMTP with exponential backoff retry; log delivery status | `app/jobs/worker.py` [PDF 13] |

### Required Email Templates [PDF 13]
1. Password reset link [PDF 13].
2. Welcome customer registration [PDF 13].
3. Quotation review with acceptance link [PDF 13].
4. Invoice issued (with PDF attached) [PDF 13].
5. Payment receipt confirmation [PDF 13].
6. Subscription renewal notice [PDF 13].
7. Overdue payment reminder [PDF 13].

---

## 14. Backend Directory Structure [PDF 14]
```text
backend/
├── app/
│   ├── main.py                 # FastAPI application factory, middleware, CORS [PDF 14]
│   ├── core/                   # Shared infrastructure [PDF 14]
│   │   ├── config.py           # Settings and environment variables
│   │   ├── security.py         # Passwords, JWT, argon2id hashing
│   │   ├── db.py               # SQLAlchemy engine and session factory
│   │   ├── deps.py             # Auth dependencies & route guards
│   │   ├── errors.py           # Custom exceptions & handlers
│   │   └── logging.py          # Structured JSON logger with request_id
│   ├── modules/                # Domain modules [PDF 14]
│   │   ├── auth/               # [Nandana] router, schemas, service, repository, models
│   │   ├── users/              # [Nandana]
│   │   ├── customers/          # [Nandana]
│   │   ├── catalog/            # [Nandana]
│   │   ├── plans/              # [Nandana]
│   │   ├── templates/          # [Nandana]
│   │   ├── subscriptions/      # [Vrindha]
│   │   ├── taxes/              # [Nandana]
│   │   ├── discounts/          # [Nandana]
│   │   ├── invoices/           # [Vrindha]
│   │   ├── payments/           # [Vrindha]
│   │   ├── reports/            # [Nandana]
│   │   ├── notifications/      # [Vrindha]
│   │   └── audit/              # [Nandana]
│   ├── jobs/                   # Background tasks [Vrindha] [PDF 14]
│   │   ├── billing_run.py
│   │   ├── renewals.py
│   │   ├── dunning.py
│   │   ├── snapshots.py
│   │   └── worker.py
│   └── templates/              # Email Jinja2 templates & HTML-to-PDF invoice [PDF 14]
├── tests/                      # Automated test suite [PDF 14]
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── requirements.txt
└── Dockerfile
```

---

## 15. Testing, Deployment and Observability [PDF 15]
- **Unit Tests**:
  - Pricing logic with inclusive and exclusive taxes [PDF 15].
  - Discount eligibility matching and best single discount selection [PDF 15].
  - Date math: month-end clamping (Jan 31 -> Feb 28), leap years (Feb 29), weekly (+7), daily (+1) [PDF 15].
  - Subscription state machine transition matrix validation [PDF 15].
  - Password strength regex validator [PDF 15].
- **Integration Tests**:
  - Billing run executed twice against the same period generates exactly one invoice [PDF 15].
  - Concurrent billing workers do not process duplicate subscriptions (`FOR UPDATE SKIP LOCKED`) [PDF 15].
  - Discount usage limit under concurrent billing runs never exceeds `usage_limit` [PDF 15].
  - Partial payments recompute balance accurately; full payment sets invoice to Paid [PDF 15].
  - Customer isolation: Customer token attempting to read another customer's invoice returns 403/404 [PDF 15].
  - RBAC verification on every single endpoint [PDF 15].
- **E2E Flow**: Signup -> Template -> Quotation -> Confirm -> Activate -> Bill -> Pay -> Report [PDF 15].
- **Observability**: Structured JSON logging including `request_id`, Prometheus latency metrics, Sentry error tracking, alerts on failed billing runs [PDF 15].

---

## 16. Edge Cases Handled in Backend [PDF 16]
- **Plan Price Changes**: When plan price is updated, existing subscription lines retain their snapshot `unit_price`; new prices apply only on renewal or explicit repricing [PDF 16].
- **Minimum Quantity Guard**: Rejects updates setting line quantity below `plan.min_quantity` [PDF 16].
- **Discount Expiry**: Re-evaluates discount validity at invoice build time (`invoice_date <= end_date`) [PDF 16].
- **Cancelled Invoice Discount Release**: When an unpaid invoice is cancelled, decrement `discount_rules.usage_count` and remove redemption row [PDF 16].
- **Tax Rule Modifications**: Historic invoices and subscriptions remain unchanged with their snapshot tax rates [PDF 16].
- **Paused Subscriptions**: Billing run ignores subscriptions with status `Paused`. Resume recomputes `next_billing_date` preserving remaining unbilled duration [PDF 16].
- **Duplicate Payment Submissions**: Enforce idempotency via `Idempotency-Key` header; duplicate requests return cached response without duplicate billing [PDF 16].
- **Customer Soft Delete**: Customers are flagged with `deleted_at`; historic invoices and contracts remain intact for accounting integrity [PDF 16].
- **Timezone Standardization**: Store all timestamps in UTC (`TIMESTAMPTZ`); compute billing dates relative to configured company timezone [PDF 16].

---

## 17. Delivery Plan Mapping [PDF 17]
- **Phase 1**: DB integration, auth, roles, password reset, staff creation, audit interceptor [PDF 17].
- **Phase 2**: Products, variants, plans, tax engines [PDF 17].
- **Phase 3**: Customers, quotation templates, subscriptions lifecycle engine [PDF 17].
- **Phase 4**: Invoicing engine, discount engine, automated billing job, PDF rendering [PDF 17].
- **Phase 5**: Payment recording, balance recomputation, overdue & dunning job, email reminders [PDF 17].
- **Phase 6**: Dashboard KPI queries, summary tables aggregator, CSV export endpoints [PDF 17].
- **Phase 7**: Customer portal endpoints, performance optimizations, load test tuning [PDF 17].

---

## 18. Ideal Additions Beyond the Brief (Backend Stubs) [PDF 18]
- Credit notes & refunds service interface [PDF 18].
- Mid-cycle proration engine for plan upgrades and downgrades [PDF 18].
- Automated retry engine for failed credit card charges [PDF 18].
- Multi-currency conversion service [PDF 18].
- Coupon codes redeem API [PDF 18].

---

## Open Questions & Ambiguities [PDF Rules]
1. **`anchor_day` Column [PDF 7.2 vs 5.6]**: Section 7.2 specifies storing `anchor_day` on the subscription to prevent month-end date drift in February (e.g. Jan 31 -> Feb 28 -> Mar 31), but Section 5.6 omitted `anchor_day` from the `subscriptions` schema table. Backend implements `anchor_day SMALLINT CHECK (anchor_day BETWEEN 1 AND 31)` on `subscriptions`.
2. **Customer Upgrade/Cancel Request Flow [PDF 2, 12]**: The PDF mentions customers can "request cancel/upgrade" in the portal. Should this create an internal notification/ticket, or transition the subscription directly?
3. **Credit Storage for Overpayments [PDF 7.4]**: Section 7.4 allows overpayments to be "stored as credit if enabled". The data model in 5.2/5.9 does not include a `customer_credits` table. Should credit balances be tracked on `customers.credit_balance`?
