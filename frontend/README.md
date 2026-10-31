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

## 3.2 Hackathon Evaluation Criteria & Priorities (Surya T S)
Judges heavily weight the following dimensions for frontend scoring:
1. **Interactive, Clean UI & Consistent Color/Layout**:
   - Centralized Design System tokens (`theme.css`): cohesive color palette (slate/indigo/neutral), consistent elevation shadows, uniform spacing units, and distinct semantic colors for status badges (`draft` = gray, `quotation` = amber, `confirmed` = blue, `active` = emerald, `paused` = orange, `closed` = purple, `cancelled` = red) [PDF 12].
   - Predictable layouts: consistent header/sidebar navigation, standardized table padding, uniform button heights, and responsive drawer patterns [PDF 12].
2. **Dynamic & Real-Time Data**:
   - Real-time line item recalculation in Draft subscriptions (line subtotal, tax, and discount update dynamically on quantity/price changes) [PDF 7.1, 12].
   - Live visual password strength checklist dynamically updating as the user types [PDF 8, 12].
   - Dynamic progress indicators and polling for long-running operations (PDF generation, billing runs, and CSV exports) [PDF 11, 13].
3. **Robust Client-Side Input Validation**:
   - Zero unvalidated submissions: instant inline error messages under each field matching backend validation rules before network dispatch [PDF 8, 12].
   - Defensive boundaries preventing impossible inputs (negative prices, quantities below plan minimum, overpayment amounts > balance) [PDF 5.4, 7.4, 16].
4. **Modularity & Reusability**:
   - Clear module boundaries: feature folders (`features/auth`, `features/subscriptions`, etc.) consuming shared atomic components (`components/tables`, `components/forms`, `components/chips`, `components/charts`) [PDF 14].
5. **Usability & UX Polish**:
   - Loading skeletons during network fetches to prevent layout shifts; debounced search inputs (300 ms); graceful empty states with call-to-actions; confirmation modals for destructive operations [PDF 11, 12].
6. **Performance Budget**:
   - Fast page load (< 2s) verified via code-splitting, route lazy loading, and table virtualization [PDF 1, 11].
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
