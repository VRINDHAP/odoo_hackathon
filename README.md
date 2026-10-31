# Brightloop

> **Modern Subscription Management & Automated Recurring Revenue Engine**  
> An end-to-end subscription lifecycle platform featuring an executive finance workspace, self-service customer portal, and double-entry billing ledger.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](frontend/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](frontend/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688.svg)](backend/)
[![Python](https://img.shields.io/badge/Python-3.12-3776ab.svg)](backend/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](database/)
[![Tests Passing](https://img.shields.io/badge/Tests-39%2F39%20Passing-brightgreen.svg)](frontend/)

---

## 🎯 Overview

Brightloop solves the complexities of modern subscription commerce: variable billing cadences, multi-tier pricing, dynamic tax schedules, discount redemptions, idempotent recurring billing runs, and dunning collections. Built with a high-contrast Ramp-inspired interface and a modular monolith backend, Brightloop provides complete transparency from quote to cash.

---

## ✨ Key Features

| Domain | Highlights |
|---|---|
| **🔄 Subscription Lifecycle** | 7-stage state machine (`Draft` → `Quotation` → `Confirmed` → `Active` → `Paused` → `Closed` → `Cancelled`) with calendar anchor day persistence across months. |
| **⚡ Automated Billing Runs** | Idempotent batch billing engine (`/billing/run`) that prevents double-billing, computes inclusive/exclusive taxes, and atomically optimizes discount redemptions. |
| **🛡️ Hard Ledger & Payments** | Append-only payment recording, overpayment prevention guards (`amount <= invoice.balance`), compensatory reversals, and 0-30/31-60/61-90/90+ dunning aging buckets. |
| **👥 Multi-Tenant RBAC** | Distinct workspaces: **Admin** (full catalog, margins, staff, billing run, audit log), **Internal Staff** (quote generation, billing ops), and **Customer Portal** (`/portal/*`). |
| **📊 Executive Finance Analytics** | Real-time MRR, ARR, active subscriber counts, revenue trends, churn tracking, and instant CSV exports. |
| **⌨️ Keyboard-First UX** | Global command palette (`Ctrl+K`), segmented filter tabs, virtualized >1,000 row data tables, and zero-flicker stateful offline ledger fallback. |

---

## 🏛️ Architecture

```
brightloop/
├── frontend/               # React 19 + TypeScript + Vite SPA (Ramp design system)
│   ├── src/features/       # Domain modules: auth, catalog, subscriptions, invoices, payments, reports, portal
│   ├── src/api/            # OpenAPI client, live adapter, real-time sync bus, stateful mock engine
│   └── src/styles/         # High-contrast slate canvas & semantic status palette
├── backend/                # FastAPI + Python 3.12 modular monolith REST API
│   ├── app/routers/        # Domain endpoints (catalog, subscriptions, billing, payments, reports)
│   ├── app/services/       # Business logic (BillingRunService, TaxService, PaymentService)
│   └── app/db/             # SQLAlchemy 2.0 models, Alembic migrations, demo seeders
└── database/               # PostgreSQL schema & indexing definitions
```

---

## 🚀 Quick Start

### 1. Frontend Workspace (Standalone with Stateful Ledger)
```bash
cd frontend
npm install
npm run dev
```
Open **[http://localhost:5173](http://localhost:5173)** in your browser.

### 2. Full Stack with Docker
```bash
docker compose up -d
docker compose exec backend alembic upgrade head
docker compose exec backend python -m app.db.seed
```
- API Documentation: **[http://localhost:8000/docs](http://localhost:8000/docs)**
- Health Probe: **[http://localhost:8000/health](http://localhost:8000/health)**

---

## 🔑 Demo Accounts

Use one-click demo login buttons or manual sign-in:

| Role | Email | Password | Scope |
|---|---|---|---|
| **Administrator** | `admin@brightloop.io` | `Admin@2026!` | Full CRUD, Unit Margins, Discounts, Billing Run, Audit Log, Settings |
| **Internal Staff** | `nandana@brightloop.io` | `Staff@2026!` | Quotations, Subscriptions, Invoices, Payments, Read-Only Catalog |
| **Customer Portal** | `arjun@vervecloud.in` | `Customer@2026!` | Self-Service Subscriptions, Optional Add-ons, Invoice Pay Now, Billing Profile |

---

## 🧪 Verification & Quality Gates

```bash
# Type safety check (0 errors)
npm --prefix frontend run typecheck

# Code style & quality check (0 warnings)
npm --prefix frontend run lint

# Comprehensive test suite (39/39 passing across 10 suites)
npm --prefix frontend run test

# Production bundle build
npm --prefix frontend run build
```

---

## 🤝 Community & Governance

- [Code of Conduct](CODE_OF_CONDUCT.md) — Contributor Covenant v2.1
- [Contributing Guide](CONTRIBUTING.md) — Development workflow, code standards, and PR process
- [Security Policy](SECURITY.md) — Vulnerability reporting and disclosure guidelines
- [License](LICENSE) — MIT License
