# Frontend Definition of Done — Subscription Management System (Brightloop)

All items must be satisfied and verified by Surya T S before frontend deliverables are considered complete.

---

## 1. Non-Negotiable Guarantees [PDF 1, 2, 8, 11]
- [x] **Performance Budget**: Every page responds and reaches interactive state in under 2.0 seconds with thousands of records [PDF 1, 11].
- [x] **3-Layer RBAC Enforcement (Client)**: Route guards protect Admin, Staff, and Customer views; unauthorized URL routes redirect with notice; navigation menus hide unauthorized modules [PDF 2, 12].
- [x] **Customer Data Isolation**: Portal screens strictly query `/me/*` endpoints; one customer can never see another customer's subscriptions, invoices, or payments [PDF 2, 9].
- [x] **No Double Submissions**: Submit buttons disable on click during in-flight network requests; payment submissions pass a unique `Idempotency-Key` header [PDF 8, 16].
- [x] **Financial Precision Display**: All money values display formatted from `NUMERIC(14,2)`, right-aligned with document currency code; invoice totals equal the exact sum of displayed line items [PDF 5, 7.1, 12].
- [x] **Relational Backend Alignment**: Frontend connects exclusively to relational backend (PostgreSQL 16+ / MySQL 8+); zero integration with MongoDB, Firebase Firestore, or cloud BaaS platforms.
- [x] **Self-Contained & Minimal 3rd-Party API Footprint**: Auth is handled internally (no Firebase Auth / Auth0 SDKs); payment flows support internal simulated sandbox mode allowing full testing without third-party API keys.

---

## 2. Screen Verification Checklist [PDF 12]

### Public Screens [PDF 12]
- [x] Landing/Login page renders with email and password inputs; handles 401 and account lockout states [PDF 9, 12].
- [x] Sign Up screen implements live password-rule checklist turning green dynamically for regex `^(?=.*[a-z])(?=.*[^A-Za-z0-9]).{9,}$` [PDF 8, 12].
- [x] Forgot/Reset password displays constant notification: *"If the email exists, a link was sent"* [PDF 9, 12].

### Admin and Staff Application [PDF 12]
- [x] Executive Dashboard renders KPI cards (Active Subs, MRR, ARR, Invoiced, Outstanding, Overdue, New/Closed) [PDF 10, 12].
- [x] Revenue trend line chart and payment method breakdown chart render accurately [PDF 10, 12].
- [x] Aging buckets widget displays `0-30`, `31-60`, `61-90`, `90+` day breakdown [PDF 7.5, 10].
- [x] Customer Directory table includes filters, search, and pagination; customer detail view displays Subscriptions, Invoices, and Payments tabs [PDF 12].
- [x] Products & Variants screen allows editing variants; margin (`sales - cost`) visible strictly to Admin [PDF 5.3, 12].
- [x] Plans screen shows billing period selectors, min quantity, and behavior toggle flags [PDF 5.4, 12].
- [x] Tax rules management table displays inclusive/exclusive badges and rates [PDF 5.7, 12].
- [x] Discounts screen (Admin only) allows creating rules and tracks usage count against usage limit [PDF 5.8, 12].
- [x] Quotation Templates builder allows line item configuration and has a working "Create Quotation" button [PDF 5.5, 12].
- [x] Subscription Detail displays visual state stepper: `Draft -> Quotation -> Confirmed -> Active -> Closed` [PDF 6.1, 12].
- [x] Subscription line editor allows unit price and quantity changes in `Draft` status only [PDF 7.1, 12].
- [x] Subscription action buttons (Pause, Close, Renew) render only if corresponding plan flags (`pausable`, `closable`, `renewable`) are true [PDF 5.4, 6.1].
- [x] Invoices list shows paid/outstanding/overdue badges; detail view includes Confirm, Cancel, Send, Print, and PDF download buttons [PDF 5.9, 6.2, 12].
- [x] Paid invoices disable the Cancel button with a prompt to issue a credit note [PDF 6.2].
- [x] Payments register displays method, date, reference; Record Payment drawer validates amount <= balance and blocks overpayments [PDF 7.4, 12].
- [x] Manual "Run Billing Now" trigger (Admin only) displays summary modal with created/skipped/failed counts [PDF 5.10, 7.2].
- [x] Staff Management (Admin only) allows inviting new staff members [PDF 2, 12].
- [x] Audit Log screen (Admin only) displays actor, entity, timestamp, and expandable before/after JSON diffs [PDF 5.10, 12].

### Customer Portal [PDF 12]
- [x] My Subscriptions displays active subscription card, next billing date, and request buttons (pause/cancel/upgrade) [PDF 12].
- [x] My Invoices shows paid/outstanding badges, PDF download link, and "Pay Now" gateway trigger [PDF 12].
- [x] Payment History displays past transaction receipts [PDF 12].
- [x] Profile and Password page allows updating billing address and changing password [PDF 8, 12].

---

## 3. UX and Code Quality Standards [PDF 11, 12, 14]
- [x] Statuses are consistently rendered as colored chips plus steppers [PDF 12].
- [x] Destructive actions (Cancel, Close, Demote) require modal confirmation [PDF 12].
- [x] Forms validate inline and display backend error messages mapped from `{ "fields": [...] }` [PDF 8, 12].
- [x] Every list implements filters, search, sorting, and empty state illustrations [PDF 12].
- [x] Fully responsive on desktop, tablet, and mobile viewports [PDF 12].
- [x] Virtualized lists implemented for large data sets [PDF 11].
- [x] Skeleton loaders display during data fetching to prevent layout shifts [PDF 11].
- [x] Search inputs debounced with 300 ms delay [PDF 11].
- [x] Zero business rules logic residing in frontend UI components [PDF 3].

---

## 4. Testing & Verification [PDF 15]
- [x] **Unit Tests**: Password validator, form validators, currency formatters, and MRR display helpers pass with > 80% coverage [PDF 15].
- [x] **E2E Test Flow**: Automated Cypress/Playwright/Vitest test executes: Customer Signup -> Admin creates Plan -> Staff creates Quote -> Customer confirms -> Activation -> Invoice generated -> Payment recorded -> Dashboard updated [PDF 15].
- [x] **Lighthouse Performance Audit**: Performance score >= 90; Largest Contentful Paint (LCP) < 2.0s [PDF 11].

---

## 5. Hackathon Evaluation Rubric Checklist (Surya T S)
- [x] **Performance**: Fast page load (< 2s) verified; lazy loaded modules; virtualized tables for large dataset rendering [PDF 1, 11].
- [x] **Coding Standards**: Strict TypeScript type-safety; ESLint/Prettier clean; no `any` types; no hardcoded styling or magic strings [PDF 14].
- [x] **Logic**: Flawless client routing, state flow, line calculation sums, and button-gating based on plan flags [PDF 5.4, 6.1].
- [x] **Modularity & Architecture**: Clear folder separation (`features/`, `components/`, `api/`, `hooks/`, `utils/`); atomic, reusable UI components [PDF 14].
- [x] **Frontend Design**: Clean, interactive UI with consistent curated color tokens (`theme.css`), standardized semantic status chips, and uniform spacing/elevation [PDF 12].
- [x] **Scalability**: Handles thousands of items smoothly via virtualized scrolling and paginated queries [PDF 1, 11].
- [x] **Usability**: Real-time line item updates, live password rule feedback, skeleton loaders, debounced search, clear empty states, and inline validation [PDF 8, 11, 12].
- [x] **Security**: 3-layer RBAC route guards active; JWT token auto-refresh interceptor; no credentials or sensitive tokens in local storage or console logs [PDF 2, 9].
- [x] **Debugging Skills**: Clear client error handling; API validation errors mapped directly to form fields; zero uncaught exceptions in browser console [PDF 8].
- [x] **Database & Dynamic Data Alignment**: Integrates with PostgreSQL/MySQL relational API; dynamically recalculates and displays live state updates without page reloads [PDF 3, 7.1].
