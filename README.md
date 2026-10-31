# Brightloop

Subscription Management & Recurring Revenue Automation System

Brightloop is an end-to-end platform for subscription commerce and recurring billing. It automates the full customer lifecycle from initial quotation and self-service confirmation to periodic invoice generation, tax calculation, atomic discount redemption, double-entry payment settlement, and dunning collections.

---

## What Brightloop Does

Managing subscription revenue manually or across disconnected spreadsheets creates billing anchor drift, calculation errors, accidental overpayments, and uncoordinated customer handoffs. Brightloop provides a single source of truth across three specialized workspaces:

1. **Administrator Workspace**: Complete control over contracted catalog pricing, cost margins, behavioral plan flags, discount rules, batch billing runs, staff provisioning, and audit logs.
2. **Internal Staff Workspace**: Operational quoting, sales subscription management, invoice creation, and payment recording without exposure to sensitive profit margins or system configurations.
3. **Customer Portal**: An isolated self-service portal where customers can review active subscriptions, toggle optional add-ons on or off, confirm quotations, execute sandbox payments, and update billing details without contacting support.

---

## Core System Architecture

### 1. Subscription Lifecycle State Machine
Subscriptions transition through seven deterministic states governed by strict business rules:
- **Draft**: Initial entry for line items, quantities, and pricing configuration.
- **Quotation**: Formal quote submitted to customer with active pricing terms.
- **Confirmed**: Customer acceptance received.
- **Active**: Service active with fixed calendar anchor day (e.g., day 31 persists as Jan 31 -> Feb 28 -> Mar 31).
- **Paused**: Temporarily halted; billing engine skips generation and reports exclude active metrics.
- **Closed**: Terminated per plan terms or mutual agreement.
- **Cancelled**: Terminated prior to activation.

### 2. Idempotent Recurring Billing Engine
The batch billing service scans all active subscriptions due on or before a target date:
- Generates snapshot invoices with line items, quantities, and contracted rates.
- Evaluates and applies the optimal valid discount rule (percentage or fixed).
- Calculates exact tax breakdown supporting both inclusive and exclusive tax schedules.
- Advances the next billing date to the next cycle while preserving calendar anchor rules.
- Prevents double-billing: Repeated execution for the same cycle safely detects existing invoices and skips duplicate generation.

### 3. Payment Settlement and Overpayment Guard
- Supports multiple payment methods (Card, Bank Transfer, UPI, Cash) with unique reference tracking.
- Hard validation prevents any payment amount from exceeding the remaining invoice balance.
- Paying the full balance automatically marks the invoice as Paid.
- Compensatory payment reversal decrements paid amounts and restores invoice balances.
- Dunning engine groups unpaid invoices into 0-30, 31-60, 61-90, and 90+ day aging buckets with reminder tracking.

### 4. Executive Finance Analytics
Real-time dashboard metrics computed dynamically from the underlying ledger:
- Monthly Recurring Revenue (MRR) with normalized monthly/yearly cadences.
- Annual Recurring Revenue (ARR).
- Active subscriber counts excluding paused and closed accounts.
- Revenue trends with interactive horizon filtering (3, 6, 12 months).
- CSV report exports for subscriptions, payments, and overdue accounts.

---

## Technical Stack

- **Frontend**: React 19, TypeScript, Vite, React Router 7, Vitest, Testing Library.
- **Backend**: Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2.0, Alembic.
- **Database**: PostgreSQL 16 (production) with SQLite support for isolated tests.
- **Cache & Concurrency**: Redis 7-alpine for distributed locking and telemetry caching.
- **Design System**: High-contrast slate canvas, clear physical element separation, and semantic status tags.

---

## Quick Start

### Frontend (Standalone Mode)
The frontend includes a built-in stateful ledger mock engine that mirrors the backend OpenAPI 3.0 specification. You can run and evaluate the complete UI without requiring external databases:

```bash
cd frontend
npm install
npm run dev
```

The application will be accessible at: `http://localhost:5173`

### Full Stack (Docker Compose)
To run the complete production stack (FastAPI web server, PostgreSQL, Redis):

```bash
docker compose up -d
docker compose exec backend alembic upgrade head
docker compose exec backend python -m app.db.seed
```

- Web Application: `http://localhost:5173`
- Backend API Docs (Swagger): `http://localhost:8000/docs`
- Backend Health Probe: `http://localhost:8000/health`

---

## Quality and Verification

All code adheres to strict type checks, linting, and automated unit and integration tests:

```bash
# Type check (0 errors)
npm --prefix frontend run typecheck

# Code style and linting (0 warnings)
npm --prefix frontend run lint

# Comprehensive test suite (39 tests across 10 suites)
npm --prefix frontend run test

# Production bundle build
npm --prefix frontend run build
```

---

## Repository Governance

- [Code of Conduct](CODE_OF_CONDUCT.md): Contributor Covenant v2.1
- [Contributing Guidelines](CONTRIBUTING.md): Branching, commit conventions, and review workflow
- [Security Policy](SECURITY.md): Vulnerability reporting procedures and response SLAs
- [License](LICENSE): MIT License
