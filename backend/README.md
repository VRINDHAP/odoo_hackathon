# Backend — Subscription Management System (Brightloop)

## 1. Purpose
This folder contains the complete technical specification, module division, task breakdown, API interfaces, and definition of done for the modular monolith REST API, background worker engine, and asynchronous jobs of the Subscription Management System [PDF 1, 3, 4, 14].

## 2. Module Ownership Split
Work is strictly partitioned between two developers so no two people edit the same file:

- **Nandana**:
  - `auth` & `security`: Authentication, JWT tokens, password hashing/reset, RBAC route guards, rate limiting, lockout [PDF 2, 4, 9].
  - `users`: User entity, staff creation, last-admin demotion guard [PDF 4, 5.1, 9].
  - `customers`: Customer entity, profile management, customer isolation guards [PDF 4, 5.2, 9].
  - `catalog`: Products, product variants, price calculation, cost/margin visibility [PDF 4, 5.3].
  - `plans`: Plan definitions, billing intervals, behavior flags (`auto_close`, `closable`, `pausable`, `renewable`) [PDF 4, 5.4].
  - `templates`: Quotation templates and line items [PDF 4, 5.5].
  - `taxes`: Tax rules, percentage/fixed calculations, inclusive/exclusive tax formulas [PDF 4, 5.7, 7.1].
  - `discounts`: Discount rules, eligibility engine, concurrency-safe usage counter, scope matching [PDF 4, 5.8, 7.3].
  - `reports`: KPI calculations (MRR/ARR normalization, revenue, overdue), summary aggregations, CSV exports [PDF 4, 10].
  - `audit`: Full audit trail recording for money-affecting entities (before/after JSON) [PDF 4, 5.10, 9].

- **Vrindha**:
  - `subscriptions`: Subscription lifecycle, contract numbering, line items snapshotting, central `transition()` state machine [PDF 4, 5.6, 6.1].
  - `billing`: Automated billing engine (`run_billing`), month-end clamping, leap year handling, anchor day logic, anti-double-billing guarantee [PDF 4, 7.2].
  - `invoices`: Invoice lifecycle, line item generation, invoice numbering, state transitions (`Draft -> Confirmed -> Paid`) [PDF 4, 5.9, 6.2].
  - `payments`: Payment recording, allocation to invoice, atomic balance recomputation, overpayment guard, append-only reversals [PDF 4, 5.9, 7.4].
  - `jobs`: Background schedulers (Billing run, Activation, Auto-close, Renewal reminders, Overdue/Dunning, Quote expiry, Report snapshots) [PDF 3, 13].
  - `notifications`: Email queue with exponential backoff, transactional email templates [PDF 4, 5.10, 13].
  - `pdfs`: Headless invoice PDF rendering and S3-compatible storage upload [PDF 3, 5.9, 8, 11].

## 3. Technology Stack
- **Framework**: FastAPI (Python 3.11+) or NestJS modular monolith [PDF 3]
- **Database Engine**: PostgreSQL 16+ (or MySQL 8+) relational database with SQLAlchemy 2.0 ORM [PDF 3, 11]
- **Connection Pooling**: PgBouncer transaction pooling [PDF 11]
- **Worker & Queue**: Celery / RQ or BullMQ backed by Redis for background jobs and scheduled tasks [PDF 3, 13]
- **Caching**: Redis for dashboard KPIs (TTL 1-5 min) and catalog lookups [PDF 11]
- **Storage**: S3-compatible local/MinIO or filesystem storage for generated invoice PDFs [PDF 3]
- **Email**: Standard SMTP client / local MailHog for transactional emails with retry/backoff queue [PDF 3, 13]

## 3.1 Hackathon Architectural Mandate (Strict Database & API Rules)
- **Relational SQL Database Mandate**: All persistence must run on a relational SQL database: PostgreSQL 16+ (or MySQL 8+).
  - Multi-table financial consistency (invoices + discount redemptions + subscription date progression) requires atomic relational ACID transactions [PDF 3, 7.2].
  - Strictly **FORBIDDEN**: MongoDB, Firebase (Firestore / Realtime Database), CouchDB, DynamoDB, or cloud BaaS layers (Supabase, Firebase).
- **Minimal Third-Party API Footprint**: Do NOT make the application depend on heavy external SaaS APIs:
  - **Self-Hosted Auth**: Built-in argon2id and JWT engine; no Firebase Auth, Clerk, or Auth0 [PDF 9].
  - **Native PDF Rendering**: Self-hosted headless PDF engine (e.g. WeasyPrint / ReportLab); zero external cloud PDF APIs [PDF 3, 11].
  - **Local Storage Fallback**: Support local disk / MinIO for invoice PDFs so AWS S3 credentials are never mandatory [PDF 3].
  - **Built-in Mock/Sandbox Payment Provider**: The `PaymentProvider` interface must include a `SimulatedPaymentProvider` alongside Razorpay/Stripe so evaluators can test instant checkout and webhooks offline with zero external API keys [PDF 7.4].
  - **Local Mailer**: SMTP client works with standard SMTP or local MailHog container without requiring paid SendGrid/Mailgun accounts [PDF 13].

## 4. How to Run
```bash
# Navigate to backend workspace
cd backend

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: .\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start Redis and Postgres (via database docker-compose)
# (Managed by Sooraj in /database)

# Run FastAPI development server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Start background worker
celery -A app.jobs.worker worker --loglevel=info

# Start job beat scheduler
celery -A app.jobs.worker beat --loglevel=info

# Run test suite
pytest -v
```

## 5. Folder Rules & Layering Architecture
- **Layering inside each module**: `router (HTTP)` -> `service (business rules)` -> `repository (SQL)` -> `models (entities)` [PDF 3].
- **Core Isolation**: Core business rules (pricing, tax formulas, state transitions, idempotency checks) must strictly reside in `service.py`, never in routers or frontend [PDF 3].
- **Single Transaction Boundary**: Multi-entity operations (e.g. invoice generation + discount usage increment + subscription date update) must commit together in a single database transaction [PDF 3, 7.2].
- **Work Split Integrity**: Nandana and Vrindha work in separate module folders. Shared interfaces are mediated via `app/core/` and the typed contracts in `INTERFACES.md`.

## 6. Team Dependencies
- **Database Team (`/database`)**:
  - **Sooraj**: Owns all schema definitions, migrations (Alembic), indexes, summary tables, and Docker Compose configurations [PDF 5, 11, 14]. Backend developers NEVER write database migrations.
- **Frontend Team (`/frontend`)**:
  - **Surya T S**: Consumes REST endpoints defined in `INTERFACES.md`. Backend delivers the OpenAPI contract first so frontend can work concurrently with mocks [PDF 8, 14].
