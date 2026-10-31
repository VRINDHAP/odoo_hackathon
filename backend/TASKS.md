# Backend Task Checklist — Subscription Management System (Brightloop)

Tasks are ordered strictly according to the 7-Phase Delivery Plan [PDF 17]. Every task is tagged with its sole owner: `[Nandana]` or `[Vrindha]`.

---

## Phase 1: Foundation (DB Models, Auth, Roles, Password Reset, Staff Creation, Audit) [PDF 17]

- [x] **BE-1.1 [Nandana]**: Create core application structure, config loader, database session manager, and error handlers [PDF 14].
  - **Input**: Environment config variables (`DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`).
  - **Expected Output**: Reusable `app/core/` modules (`config.py`, `db.py`, `errors.py`, `deps.py`).
  - **Acceptance Test**: App starts up and connects to PostgreSQL and Redis cleanly.
  - **Dependencies**: None.

- [x] **BE-1.2 [Nandana]**: Implement User and Identity models with argon2id/bcrypt password hashing [PDF 5.1, 9].
  - **Input**: SQLAlchemy definitions for `users`, `password_reset_tokens`, `refresh_tokens`.
  - **Expected Output**: Working ORM models and password hashing utility functions.
  - **Acceptance Test**: Password hashing generates valid hash; verification succeeds on correct password and fails on incorrect password.
  - **Dependencies**: BE-1.1.

- [x] **BE-1.3 [Nandana]**: Build Auth endpoints (Signup, Login, Token Refresh, Logout) [PDF 8, 9].
  - **Input**: `POST /auth/signup`, `/auth/login`, `/auth/refresh`, `/auth/logout`.
  - **Expected Output**: Working auth router issuing 15-min JWT access token and 7-day rotating hashed refresh token.
  - **Acceptance Test**: Public signup creates `customer` role only; duplicate email returns 409; valid login returns JWT.
  - **Dependencies**: BE-1.2.

- [x] **BE-1.4 [Nandana]**: Implement Password Strength validator and Account Lockout mechanism [PDF 5.1, 8, 9].
  - **Input**: Regex `^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$`; failed login counter.
  - **Expected Output**: Request validation rejecting weak passwords; account locked for 15 minutes after 5 consecutive failures.
  - **Acceptance Test**: Password shorter than 9 chars or lacking uppercase/lowercase/symbol fails with HTTP 422; 5th failed login sets `locked_until`.
  - **Dependencies**: BE-1.3.

- [x] **BE-1.5 [Nandana]**: Implement Forgot and Reset Password flow with anti-enumeration response [PDF 8, 9].
  - **Input**: `POST /auth/forgot-password`, `POST /auth/reset-password`.
  - **Expected Output**: 256-bit random reset token generated and hashed; constant response *"If the email exists, a link was sent"*.
  - **Acceptance Test**: Non-existent email returns 200 with constant response; valid reset updates password and revokes all refresh tokens.
  - **Dependencies**: BE-1.3.

- [x] **BE-1.6 [Nandana]**: Build Staff Creation endpoint with last-admin demotion guard [PDF 2, 8, 9].
  - **Input**: `POST /users/staff`.
  - **Expected Output**: Admin-only staff provisioning endpoint; rule preventing deletion/demotion of last admin.
  - **Acceptance Test**: Staff or Customer calling `/users/staff` gets 403; demoting only remaining admin returns 400 Bad Request.
  - **Dependencies**: BE-1.3.

- [x] **BE-1.7 [Nandana]**: Implement Audit Logging interceptor for money-affecting entities [PDF 5.10, 9].
  - **Input**: SQLAlchemy event listeners / service layer hook.
  - **Expected Output**: Automated insertion into `audit_logs` capturing `actor_id`, `entity`, `action`, `before_json`, `after_json`, `ip`, `at`.
  - **Acceptance Test**: Updating a product price or user role creates an immutable audit row with exact JSON diff.
  - **Dependencies**: BE-1.2.

---

## Phase 2: Catalog (Products, Variants, Plans, Taxes) [PDF 17]

- [x] **BE-2.1 [Nandana]**: Implement Products and Variants models and CRUD endpoints [PDF 5.3, 8].
  - **Input**: `GET/POST /products`, `GET/PATCH/DELETE /products/{id}`, `POST /products/{id}/variants`.
  - **Expected Output**: Working catalog router; variant table with `UNIQUE(product_id, attribute, value)`.
  - **Acceptance Test**: Effective price calculates `sales_price + extra_price`; cost margin exposed strictly to Admin.
  - **Dependencies**: BE-1.3, BE-1.7.

- [x] **BE-2.2 [Nandana]**: Implement Plans model and endpoints with plan behavior flags [PDF 5.4, 8].
  - **Input**: `GET/POST /plans`, `PATCH /plans/{id}`.
  - **Expected Output**: Plans module supporting intervals (`daily`, `weekly`, `monthly`, `yearly`) and flags (`auto_close`, `closable`, `pausable`, `renewable`, `is_active`).
  - **Acceptance Test**: Admin can create and update plan flags; non-admin cannot mutate plans.
  - **Dependencies**: BE-1.3.

- [x] **BE-2.3 [Nandana]**: Implement Taxes model and calculation service (inclusive & exclusive) [PDF 5.7, 7.1, 8].
  - **Input**: `GET/POST/PATCH /taxes`.
  - **Expected Output**: Taxes module; service calculating `exclusive_tax = taxable * rate` and `inclusive_tax = taxable - taxable/(1+rate)`.
  - **Acceptance Test**: Unit test confirms exact tax amounts for 18% inclusive and exclusive on INR 1,000.
  - **Dependencies**: BE-1.3.

---

## Phase 3: Sales (Customers, Quotation Templates, Subscriptions) [PDF 17]

- [x] **BE-3.1 [Nandana]**: Implement Customers model, repository, and CRUD endpoints [PDF 5.2, 8].
  - **Input**: `GET/POST /customers`, `GET/PATCH /customers/{id}`.
  - **Expected Output**: Customers module with billing address, tax ID, and soft delete (`deleted_at`).
  - **Acceptance Test**: Creating customer returns ID; soft deleting customer sets `deleted_at` without removing record.
  - **Dependencies**: BE-1.3.

- [x] **BE-3.2 [Nandana]**: Implement Quotation Templates and one-click quotation factory [PDF 5.5, 8].
  - **Input**: `GET/POST /quotation-templates`, `POST /quotation-templates/{id}/create-quotation`.
  - **Expected Output**: Templates router; factory cloning template lines into a new `Draft` subscription.
  - **Acceptance Test**: Invoking `/create-quotation` creates a `draft` subscription containing the template's line items and pricing.
  - **Dependencies**: BE-2.1, BE-2.2, BE-3.1.

- [ ] **BE-3.3 [Vrindha]**: Implement Subscriptions and Subscription Lines models with sequence number generator [PDF 5.6].
  - **Input**: Database sequence for `number` (e.g. `SUB-2026-000123`); `anchor_day` column [PDF 7.2].
  - **Expected Output**: Subscriptions ORM models snapshotting line `unit_price`, `tax_id`, `discount_id`.
  - **Acceptance Test**: Contract created with unique formatted sequence; updating catalog product later does not alter subscription line unit price.
  - **Dependencies**: BE-1.1, BE-3.1.

- [ ] **BE-3.4 [Vrindha]**: Implement Central Subscription State Machine and transition validator [PDF 6.1, 8].
  - **Input**: `transition(subscription, target_status, actor)` service function; `POST /subscriptions/{id}/transition`.
  - **Expected Output**: Strict matrix validation enforcing transitions (`Draft -> Quotation -> Confirmed -> Active -> Closed/Paused/Cancelled`).
  - **Acceptance Test**: Invalid transition throws exception returning HTTP 409; valid transition updates status and writes audit log.
  - **Dependencies**: BE-3.3, BE-1.7.

- [ ] **BE-3.5 [Vrindha]**: Implement Subscription Pause, Resume, Close, and Renew actions [PDF 5.4, 6.1, 8].
  - **Input**: `POST /subscriptions/{id}/pause`, `/resume`, `/close`, `/renew`.
  - **Expected Output**: Specific transition endpoints verifying corresponding plan behavior flags (`pausable`, `closable`, `renewable`).
  - **Acceptance Test**: Pausing when `plan.pausable == false` returns 409; Closing requires `close_reason`; Resuming recomputes `next_billing_date`.
  - **Dependencies**: BE-3.4, BE-2.2.

---

## Phase 4: Billing (Invoices, Discounts, Billing Job Engine, PDFs) [PDF 17]

- [x] **BE-4.1 [Nandana]**: Implement Discounts model and dynamic eligibility evaluation engine [PDF 5.8, 7.3, 8].
  - **Input**: `GET/POST/PATCH /discounts`, `GET /discounts/{id}/usage`.
  - **Expected Output**: Service evaluating discount eligibility at invoice build time; applies best single eligible discount.
  - **Acceptance Test**: Expired discount is rejected; among 2 eligible discounts, largest monetary deduction is applied.
  - **Dependencies**: BE-1.3, BE-2.1.

- [x] **BE-4.2 [Nandana]**: Implement concurrency-safe Discount Usage counter and release on cancellation [PDF 5.8, 7.3].
  - **Input**: Atomic SQL update: `UPDATE discount_rules SET usage_count = usage_count + 1 WHERE usage_count < usage_limit`.
  - **Expected Output**: Thread-safe usage increment; redemption row recorded; release logic upon invoice cancellation.
  - **Acceptance Test**: Concurrent calls cannot increment `usage_count` beyond `usage_limit`; cancelling invoice decrements counter.
  - **Dependencies**: BE-4.1.

- [ ] **BE-4.3 [Vrindha]**: Implement Invoices and Invoice Lines models with anti-double-billing constraint [PDF 5.9].
  - **Input**: Constraint `UNIQUE(subscription_id, period_start, period_end)`.
  - **Expected Output**: Invoices ORM model, line item generator, invoice numbering sequence.
  - **Acceptance Test**: Attempting to insert two invoices with identical `subscription_id`, `period_start`, and `period_end` fails DB constraint.
  - **Dependencies**: BE-3.3.

- [ ] **BE-4.4 [Vrindha]**: Implement Invoice State Machine and Actions (Confirm, Cancel, Send) [PDF 6.2, 8].
  - **Input**: `POST /invoices/{id}/confirm`, `/cancel`, `/send`.
  - **Expected Output**: State controller enforcing `Draft -> Confirmed -> Paid`; cancellation releasing discount redemptions.
  - **Acceptance Test**: Cancelling a Paid invoice is blocked with HTTP 409 ("Paid cannot be cancelled; use credit note"); sending sets `sent_at`.
  - **Dependencies**: BE-4.3, BE-4.2.

- [ ] **BE-4.5 [Vrindha]**: Implement Automated Billing Engine scheduler (`run_billing`) [PDF 7.2, 8, 13].
  - **Input**: Celery beat schedule daily at 00:30 UTC; `POST /billing/run` admin trigger.
  - **Expected Output**: Engine querying active due subscriptions (`FOR UPDATE SKIP LOCKED`), building invoices, advancing dates, logging to `billing_runs`.
  - **Acceptance Test**: Running billing twice against the same date creates invoices on first run and safely skips on second run (`created_count > 0, skipped_count > 0`).
  - **Dependencies**: BE-4.3, BE-4.1, BE-3.5.

- [ ] **BE-4.6 [Vrindha]**: Implement Month-End Date Clamping and Anchor Day math [PDF 7.2].
  - **Input**: Subscription start date (e.g. Jan 31), interval `monthly`, stored `anchor_day = 31`.
  - **Expected Output**: Billing date calculations: Jan 31 -> Feb 28 (or 29) -> Mar 31.
  - **Acceptance Test**: Unit test verifies Feb billing does not permanently drift subsequent monthly billing dates to day 28.
  - **Dependencies**: BE-4.5.

- [ ] **BE-4.7 [Vrindha]**: Implement Asynchronous Invoice PDF Generator with S3 storage upload [PDF 3, 5.9, 8, 11].
  - **Input**: `GET /invoices/{id}/pdf`.
  - **Expected Output**: Background worker rendering PDF template using Weasyprint/Playwright and uploading to S3-compatible store.
  - **Acceptance Test**: Endpoint returns valid application/pdf binary stream with accurate line items and totals.
  - **Dependencies**: BE-4.3.

---

## Phase 5: Payments (Recording, Overdue Logic, Reminders) [PDF 17]

- [ ] **BE-5.1 [Vrindha]**: Implement Payments model and atomic payment recording service [PDF 5.9, 7.4, 8].
  - **Input**: `POST /invoices/{id}/payments`, `Idempotency-Key` header.
  - **Expected Output**: Atomic payment insert, recomputing invoice `amount_paid` and `balance = total - amount_paid`.
  - **Acceptance Test**: Partial payment updates balance; payment bringing balance to 0 automatically flips invoice status to `Paid`.
  - **Dependencies**: BE-4.4.

- [ ] **BE-5.2 [Vrindha]**: Implement Overpayment Blocker, Idempotency-Key enforcement, and Append-Only Reversals [PDF 7.4, 8, 16].
  - **Input**: Payment request amount; idempotency header cache; negative correction entry.
  - **Expected Output**: Rejection if `amount > invoice.balance`; duplicate request returns cached response; reversals recorded as negative rows.
  - **Acceptance Test**: Overpaying by 0.01 fails with HTTP 422; duplicate POST with same Idempotency-Key does not double charge.
  - **Dependencies**: BE-5.1.

- [ ] **BE-5.3 [Vrindha]**: Implement Payment Gateway Webhook handler and `PaymentProvider` interface [PDF 7.4, 8].
  - **Input**: Razorpay/Stripe webhook payload, signature header, and local simulated checkout events.
  - **Expected Output**: Abstract provider interface with implementations: `RazorpayPaymentProvider`, `StripePaymentProvider`, and `SimulatedPaymentProvider` (built-in offline sandbox avoiding excessive third-party API dependencies).
  - **Acceptance Test**: Simulated sandbox provider processes payments offline with zero external network calls; live webhooks enforce cryptographic signature and idempotent transaction handling.
  - **Dependencies**: BE-5.1.

- [ ] **BE-5.4 [Vrindha]**: Implement Overdue Dunning Engine and Reminder Schedulers [PDF 7.5, 13].
  - **Input**: Daily scheduled job checking `status == 'confirmed' AND balance > 0 AND due_date < today`.
  - **Expected Output**: Service computing aging buckets (`0-30`, `31-60`, `61-90`, `90+`) and queuing reminder emails at due -3, 0, +3, +7, +14 days.
  - **Acceptance Test**: Invoices past due are flagged; reminder emails enqueued to notification queue with correct template.
  - **Dependencies**: BE-5.1.

---

## Phase 6: Reports & Finance Calculations [PDF 17]

- [x] **BE-6.1 [Nandana]**: Implement MRR and ARR Normalization calculation service [PDF 10].
  - **Input**: Query over all subscriptions where `status == 'Active'`.
  - **Expected Output**: MRR calculated as `monthly*1 + yearly/12 + weekly*52/12 + daily*365/12` (excluding paused); ARR = MRR * 12.
  - **Acceptance Test**: Unit test verifies exact MRR value across a mixed portfolio of daily, weekly, monthly, and yearly active plans.
  - **Dependencies**: BE-3.3.

- [x] **BE-6.2 [Nandana]**: Build Executive Summary KPI endpoint with Redis caching [PDF 10, 11].
  - **Input**: `GET /reports/summary`.
  - **Expected Output**: Aggregated metrics: Active Subscriptions, MRR, ARR, Invoiced, Collected, Outstanding, Overdue, New vs Closed.
  - **Acceptance Test**: First call computes and caches in Redis (TTL 3 min); subsequent call returns cached payload in < 20 ms.
  - **Dependencies**: BE-6.1, BE-5.1.

- [x] **BE-6.3 [Nandana]**: Build Filterable Reports Endpoints with CSV streaming export [PDF 8, 10].
  - **Input**: `GET /reports/active-subscriptions`, `/revenue`, `/outstanding`, `/overdue`, `/payments` with `?format=csv`.
  - **Expected Output**: JSON or streaming CSV file output based on format query param.
  - **Acceptance Test**: Calling endpoint with `?format=csv` returns `text/csv` header and well-formatted CSV lines.
  - **Dependencies**: BE-6.2.

- [ ] **BE-6.4 [Vrindha]**: Implement Report Snapshots background job [PDF 11, 13].
  - **Input**: Hourly and daily Celery scheduled job.
  - **Expected Output**: Aggregates raw transactional tables into `daily_revenue_summary` and `subscription_snapshot_daily`.
  - **Acceptance Test**: Summary tables populated; queries against summary tables execute in < 15 ms.
  - **Dependencies**: BE-4.3, BE-5.1.

---

## Phase 7: Customer Portal & Polish [PDF 17]

- [ ] **BE-7.1 [Vrindha]**: Build Customer Portal Subscriptions, Invoices, and Payments endpoints [PDF 2, 8, 9].
  - **Input**: `GET /me/subscriptions`, `GET /me/invoices`, `GET /me/payments`.
  - **Expected Output**: Portal endpoints strictly isolated by the caller's JWT `customer_id`.
  - **Acceptance Test**: Customer A calling `/me/subscriptions` receives only their own records; never sees Customer B data.
  - **Dependencies**: BE-1.3, BE-4.3, BE-5.1.

- [x] **BE-7.2 [Nandana]**: Build Customer Profile update endpoint [PDF 2, 8].
  - **Input**: `PATCH /me/profile` (billing address, phone, contact details).
  - **Expected Output**: Self-service profile update updating customer record associated with authenticated user.
  - **Acceptance Test**: Customer can update their billing address; cannot modify their role or other tenant accounts.
  - **Dependencies**: BE-3.1, BE-7.1.

- [ ] **BE-7.3 [Vrindha]**: Build Customer Portal Pay Endpoint [PDF 7.4, 8].
  - **Input**: `POST /me/invoices/{id}/pay`.
  - **Expected Output**: Initializes gateway checkout session (Stripe/Razorpay) for authenticated customer's invoice.
  - **Acceptance Test**: Customer cannot initiate payment on another customer's invoice (returns 404/403).
  - **Dependencies**: BE-5.3, BE-7.1.

- [ ] **BE-7.4 [Nandana & Vrindha]**: Performance optimization and load testing against performance budget [PDF 1, 11, 15].
  - **Input**: Seed database with 50,000 subscriptions and 500,000 invoices (via `/database` seed script); execute k6/Locust load tests.
  - **Expected Output**: Benchmark report demonstrating p95 response time < 300 ms across all endpoints.
  - **Acceptance Test**: Under sustained load of 500 concurrent requests, p95 latency remains < 300 ms.
  - **Dependencies**: All previous BE tasks.
