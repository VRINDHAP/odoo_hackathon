# Backend Definition of Done — Subscription Management System (Brightloop)

All items must be satisfied and verified by Nandana and Vrindha before backend deliverables are considered complete.

---

## 1. Non-Negotiable Core Guarantees [PDF 1, 5, 7, 9, 11]
- [ ] **No Double Billing Guarantee**: Database constraint `UNIQUE(subscription_id, period_start, period_end)` verified; running `run_billing` twice against the same date produces zero duplicate invoices [PDF 5.9, 7.2, 15].
- [ ] **Idempotent Background Jobs & Endpoints**: Automated billing engine is idempotent; duplicate payment submissions with identical `Idempotency-Key` return identical response without duplicate records; payment gateway webhooks deduplicated via transaction ID [PDF 7.2, 7.4, 8, 16].
- [ ] **Fixed-Precision Financial Arithmetic**: All money values typed strictly as `NUMERIC(14,2)` / `Decimal` (zero floating-point math); line rounding uses `ROUND_HALF_UP` before summing to document total [PDF 5, 7.1].
- [ ] **3-Layer RBAC Architecture**:
  1. Route guards verify JWT role on every endpoint [PDF 2].
  2. Object-level guards enforce customer ownership [PDF 2].
  3. DB-level filtering injects `customer_id` on all portal queries [PDF 2].
- [ ] **Customer Data Isolation**: Automated security integration tests assert a customer can never read or mutate records belonging to another customer [PDF 9, 15].
- [ ] **Latency Budget**: API p95 response time is strictly < 300 ms across all endpoints under 50,000 subscriptions and 500,000 invoices [PDF 1, 11, 15].
- [ ] **Single Transaction Boundary**: Invoice generation, discount redemption record, discount usage increment, and subscription date progression commit together in one transaction [PDF 3, 7.2].
- [ ] **Relational SQL Database Mandate**: All entities persist in a relational SQL database (PostgreSQL 16+ / MySQL 8+); zero usage of MongoDB, Firebase Firestore, or cloud BaaS platforms.
- [ ] **Minimal Third-Party API Footprint**:
  - Authentication functions 100% self-hosted with argon2id and JWT (no Firebase Auth or Clerk).
  - Invoice PDF generation runs natively in Python with local/MinIO file storage (no cloud PDF APIs).
  - PaymentProvider provides working `SimulatedPaymentProvider` sandbox allowing end-to-end evaluation with zero external network calls or merchant keys.
  - Email dispatching supports local MailHog / standard SMTP without requiring paid SendGrid/Mailgun accounts.

---

## 2. Nandana's Modules Verification Checklist [PDF 2, 4, 5, 7, 8, 9, 10]
- [ ] **Auth & Security**:
  - [ ] Passwords hashed with argon2id or bcrypt (cost 12); hashes never logged or exposed [PDF 9].
  - [ ] Password validator enforces regex `^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$` [PDF 8, 9].
  - [ ] Access tokens expire in 15 minutes; refresh tokens rotate on use with 7-day lifespan [PDF 9].
  - [ ] Forgot password returns constant generic message without leaking account existence [PDF 9].
  - [ ] Password reset revokes all active refresh tokens for the user [PDF 9].
  - [ ] Account lockout triggers after 5 failed login attempts [PDF 5.1, 9].
  - [ ] Public signup strictly creates `customer` role [PDF 9].
  - [ ] Admin demotion guard blocks deleting or demoting the last active administrator [PDF 9].
- [ ] **Users & Staff Provisioning**:
  - [ ] `POST /users/staff` restricted strictly to Admin [PDF 2, 8].
- [ ] **Customers**:
  - [ ] Customer profile CRUD endpoints functional; soft delete sets `deleted_at` [PDF 5.2, 16].
- [ ] **Catalog & Plans**:
  - [ ] Product variants enforce `UNIQUE(product_id, attribute, value)` [PDF 5.3].
  - [ ] Product margin (`sales_price - cost_price`) exposed strictly to Admin [PDF 5.3].
  - [ ] Plan behavior flags (`auto_close`, `closable`, `pausable`, `renewable`) properly stored and editable by Admin [PDF 5.4].
- [ ] **Quotation Templates**:
  - [ ] Template builder clones items into draft subscriptions via `/create-quotation` [PDF 5.5, 8].
- [ ] **Taxes**:
  - [ ] Inclusive tax formula `taxable - taxable / (1 + rate)` and exclusive tax formula `taxable * rate` verified by unit tests [PDF 7.1].
- [ ] **Discounts Engine**:
  - [ ] Discount eligibility evaluated dynamically at invoice build date [PDF 7.3].
  - [ ] Atomic usage count increment prevents race conditions exceeding `usage_limit` [PDF 7.3].
  - [ ] Best single eligible discount applied by default [PDF 7.3].
  - [ ] Cancelling unpaid invoice releases redemption and decrements `usage_count` [PDF 7.3, 16].
- [ ] **Reports & Dashboard**:
  - [ ] MRR normalization accurately computes `monthly*1 + yearly/12 + weekly*52/12 + daily*365/12` over active subscriptions (excluding paused) [PDF 10].
  - [ ] ARR computed as `MRR * 12` [PDF 10].
  - [ ] Dashboard summary KPIs cached in Redis with 1-5 min TTL [PDF 11].
  - [ ] Filterable report endpoints stream valid CSV files when `?format=csv` is requested [PDF 8, 10].
- [ ] **Audit Trail**:
  - [ ] Interceptor captures actor, entity, action, before/after JSON, IP, timestamp on money-affecting actions [PDF 5.10, 9].

---

## 3. Vrindha's Modules Verification Checklist [PDF 2, 4, 5, 6, 7, 8, 11, 13]
- [ ] **Subscriptions Lifecycle & State Machine**:
  - [ ] Subscription numbering generated from sequence (e.g. `SUB-2026-000123`) [PDF 5.6].
  - [ ] Central `transition(subscription, target, actor)` enforces state matrix: `Draft -> Quotation -> Confirmed -> Active -> Closed` [PDF 6.1].
  - [ ] Illegal transitions raise exception returning HTTP 409 Conflict [PDF 6.1].
  - [ ] Pause/Resume recomputes `next_billing_date` and is allowed only if `plan.pausable == true` [PDF 5.4, 6.1].
  - [ ] Close requires `close_reason` and is allowed only if `plan.closable == true` (or auto-closed at expiry) [PDF 5.4, 6.1].
  - [ ] Renew allowed only if `plan.renewable == true` and creates new term [PDF 5.4, 6.1].
  - [ ] Catalog edits never retroactively mutate snapshot unit prices on existing subscription lines [PDF 5.6, 16].
- [ ] **Automated Billing Engine**:
  - [ ] Daily scheduler runs at 00:30 UTC and processes due subscriptions (`next_billing_date <= today`) using `FOR UPDATE SKIP LOCKED` [PDF 7.2, 13].
  - [ ] Per-subscription transaction boundary ensures fault isolation: one failing subscription logs to `billing_runs` and does not abort batch [PDF 7.2].
  - [ ] Month-end calendar clamping (Jan 31 -> Feb 28) and `anchor_day` stabilization verified [PDF 7.2].
  - [ ] Leap years (Feb 29) handled properly [PDF 7.2].
  - [ ] Admin manual billing trigger `POST /billing/run` returns run summary (`created_count`, `skipped_count`, `failed_count`, `error_summary`) [PDF 5.10, 8].
- [ ] **Invoices Engine**:
  - [ ] Invoices follow state machine: `Draft -> Confirmed -> Paid` [PDF 6.2].
  - [ ] Cancelling a Paid invoice is strictly blocked (HTTP 409) [PDF 6.2].
  - [ ] Overdue condition dynamically evaluated: `status == 'confirmed' AND balance > 0 AND due_date < today` [PDF 5.9].
  - [ ] Sending invoice records `sent_at` timestamp [PDF 6.2].
  - [ ] Invoice PDF generated asynchronously and uploaded to S3 [PDF 3, 11].
- [ ] **Payments Engine**:
  - [ ] Every payment is attached to exactly one invoice [PDF 7.4].
  - [ ] Partial payments recalculate `amount_paid` and `balance` atomically [PDF 7.4].
  - [ ] Overpayments blocked with HTTP 422 [PDF 7.4].
  - [ ] Invoice automatically flips to `Paid` status when `balance == 0` [PDF 6.2, 7.4].
  - [ ] Payments are append-only; reversals recorded as negative rows [PDF 7.4].
  - [ ] PaymentProvider webhook verifies cryptographic signatures and ensures idempotency [PDF 7.4].
- [ ] **Overdue & Dunning Engine**:
  - [ ] Daily dunning scheduler refreshes aging buckets (`0-30`, `31-60`, `61-90`, `90+`) and dispatches reminders at `due - 3, 0, +3, +7, +14` days [PDF 7.5, 13].
- [ ] **Background Jobs & Email Schedulers**:
  - [ ] All 8 scheduled jobs implemented and operational [PDF 13].
  - [ ] 7 transactional email templates implemented and dispatched with retry backoff [PDF 13].
- [ ] **Customer Portal Endpoints**:
  - [ ] Portal endpoints (`/me/subscriptions`, `/me/invoices`, `/me/payments`, `/me/invoices/{id}/pay`) strictly filter by caller customer ID [PDF 8, 9].

---

## 4. Test Suite Requirements [PDF 15]
- [ ] **Unit Tests**: Pass with >= 85% branch coverage on financial math, state machines, and validators [PDF 15].
- [ ] **Integration Tests**: Pass billing idempotency test, concurrent worker test, customer data isolation test, and RBAC endpoint sweep [PDF 15].
- [ ] **E2E Test**: Automated test validates end-to-end lifecycle: Customer Signup -> Template -> Quotation -> Confirm -> Activate -> Bill -> Pay -> Report [PDF 15].
- [ ] **Load Test**: Locust / k6 execution confirms p95 latency < 300 ms under 500 concurrent users against 50,000 subscriptions and 500,000 invoices [PDF 11, 15].

---

## 5. Hackathon Evaluation Rubric Checklist (Nandana & Vrindha)
- [ ] **Performance**: API p95 < 300 ms verified under load test; zero N+1 queries; Redis caching on KPIs [PDF 1, 11].
- [ ] **Coding Standards**: PEP 8 compliance, strict Python type annotations (`mypy`), Black formatting, modular layer separation [PDF 14].
- [ ] **Logic**: Flawless financial math (line rounding half-up, discount evaluation, month-end date clamping, leap year math) [PDF 7.1, 7.2, 7.3].
- [ ] **Modularity & Architecture**: Strict `router -> service -> repository -> model` layering; clean domain isolation between Nandana and Vrindha via typed contracts [PDF 3, 14].
- [ ] **Robust Input Validation**: 100% of request bodies validated via Pydantic v2 schemas; uniform `{code, message, fields[]}` error responses [PDF 8].
- [ ] **Scalability**: PostgreSQL `FOR UPDATE SKIP LOCKED` batching verified for concurrent worker execution without deadlock [PDF 7.2].
- [ ] **Security**: 3-layer RBAC verified; customer tenant queries strictly isolated; argon2id hashing; account lockout on failed logins [PDF 2, 9].
- [ ] **Debugging Skills & Observability**: Structured JSON logging with `request_id`; Sentry tracking; detailed `billing_runs` error summaries [PDF 5.10, 15].
- [ ] **Dynamic & Real-Time Data**: Live calculation of invoice lines and taxes; real-time state machine audit emission [PDF 6.1, 7.1].
- [ ] **Database & Relational Setup**: Flawless interaction with PostgreSQL 16+ / MySQL 8+ schema; zero MongoDB/Firebase dependencies [PDF 3, 5].
