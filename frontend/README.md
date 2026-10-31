# Frontend — Subscription Management System (Brightloop)

## 1. Purpose
This folder contains the complete technical specification, task breakdown, interface requirements, and definition of done for the client-side single-page application (SPA) serving Admin, Internal Staff, and Customers (Customer Portal) [PDF 1, 3, 12].

## 2. Owner
- **Lead Developer**: Surya T S

## 3. Technology Stack
- **Framework**: React (Vite) [PDF 3]
- **Language**: TypeScript / JavaScript [PDF 3]
- **Styling**: Vanilla CSS with Design System Tokens & Responsive Media Queries
- **State & Data Fetching**: REST API client (Fetch/Axios) with JWT Bearer authentication interceptor and token auto-refresh [PDF 3, 8, 9]
- **Routing**: React Router with Route Guards for Role-Based Access Control (Admin, Staff, Customer) [PDF 2, 14]
- **Performance Tooling**: React window/virtualized lists, debounced input hooks, code-splitting (React.lazy/Suspense), skeleton loaders [PDF 11]

## 3.1 Hackathon Architecture Constraints (Strict Rules)
- **Relational SQL Backend Only**: All UI state connects to a strictly relational SQL backend (PostgreSQL 16+ / MySQL). Do NOT connect to or use Firebase, MongoDB, Supabase BaaS, CouchDB, or any NoSQL document databases.
- **Minimal Third-Party API Reliance**: Do not rely excessively on third-party SaaS APIs.
  - Use native, self-hosted backend auth (no Firebase Auth, Clerk, or Auth0 SDKs).
  - Use internal simulated/sandbox payment flows via the backend `PaymentProvider` alongside standard gateway forms (ensuring full offline testability for hackathon judges without live merchant keys).
  - Do not use cloud-hosted PDF rendering APIs or external email SaaS widgets. All PDFs and transactional notifications are served directly through the internal backend.

## 4. How to Run
```bash
# Navigate to frontend workspace
cd frontend

# Install dependencies
npm install

# Start development server (Vite)
npm run dev

# Run unit tests
npm run test

# Run linter & type checks
npm run lint
npm run typecheck

# Build production bundle
npm run build
```

## 5. Folder Rules
- **Directory Structure**: Strictly adhere to `frontend/src/` with `app/` (routes, guards), `features/` (one folder per module), `components/` (tables, forms, chips, charts), `api/`, `hooks/`, `utils/` [PDF 14].
- **No Business Logic**: Business rules (pricing math, tax calculation, transition state validation, discount eligibility) must never live in the UI; UI is an interactive presentation and input layer [PDF 3].
- **Code Ownership**: Surya T S owns all frontend UI code and assets. Never edit backend or database files from this folder.
- **Mocking**: Develop against the OpenAPI 3.0 specification defined in `backend/INTERFACES.md` using MSW or a local mock server until backend endpoints are ready [PDF 8, 14].

## 6. Team Dependencies
- **Backend Team (`/backend`)**:
  - **Nandana**: Provides Auth, Users, Customers, Catalog, Plans, Quotation Templates, Taxes, Discounts, Reports, Audit Log endpoints [PDF 4, 8].
  - **Vrindha**: Provides Subscriptions lifecycle transitions, Billing Run trigger, Invoices, Payments, PDF download, and Portal action endpoints [PDF 4, 8].
- **Database Team (`/database`)**:
  - **Sooraj**: Provides normalized enum values, database constraints, seeded test user accounts, and ensures database query response times satisfy the `< 2s` page load budget [PDF 1, 5, 11, 15].
