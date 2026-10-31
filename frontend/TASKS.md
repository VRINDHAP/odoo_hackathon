# Frontend Task Checklist — Subscription Management System (Brightloop)

Tasks are ordered strictly according to the 7-Phase Delivery Plan [PDF 17]. All tasks owned by Surya T S.

---

## Phase 1: Foundation (Auth, Roles, Password Reset, Staff Creation, Audit) [PDF 17]

- [x] **FE-1.1**: Initialize React Vite application with TypeScript, routing skeleton, and vanilla CSS design system tokens (`theme.css`).
  - **Input**: Vite React template, curated color tokens (Slate/Blue/Emerald/Amber/Rose status chips), elevation, typography, and spacing variables.
  - **Expected Output**: Running SPA dev server with clean visual theme, consistent layout grid, responsive navbar/sidebar, and interactive button/card primitives.
  - **Acceptance Test**: App loads with zero console errors; CSS variables consistently style all primitives across viewports.
  - **Dependencies**: None.

- [x] **FE-1.2**: Implement API client with JWT storage, Bearer auth header injection, and 401 token refresh interceptor [PDF 3, 8, 9].
  - **Input**: Axios/Fetch configuration and endpoints `POST /auth/refresh`, `POST /auth/login`.
  - **Expected Output**: Reusable HTTP client module that automatically handles token rotation.
  - **Acceptance Test**: Expired access token triggers silent refresh; invalid refresh redirects to `/login`.
  - **Dependencies**: FE-1.1.

- [x] **FE-1.3**: Build route guards and role-based navigation layout for Admin, Staff, and Customer [PDF 2, 12, 14].
  - **Input**: User auth state containing `role` enum (`admin`, `staff`, `customer`).
  - **Expected Output**: Guarded route wrapper restricting unauthorized routes; responsive sidebar/navbar.
  - **Acceptance Test**: Customer accessing `/settings` is redirected; Admin sees full menu; Staff sees operational menu.
  - **Dependencies**: FE-1.2.

- [x] **FE-1.4**: Build Login and Forgot/Reset Password screens with no-enumeration UX [PDF 8, 9, 12].
  - **Input**: Form inputs for email, password; reset token parameter from URL.
  - **Expected Output**: Functional login form and forgot password page displaying constant message: *"If the email exists, a link was sent"*.
  - **Acceptance Test**: Successful login stores JWT and navigates to dashboard; forgot password displays exact notification.
  - **Dependencies**: FE-1.2.

- [x] **FE-1.5**: Build Public Signup screen with live password-rule checklist and regex validation [PDF 8, 9, 12].
  - **Input**: Name, email, company, password inputs; Regex `^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$`.
  - **Expected Output**: Form with interactive checklist ticking off length > 8, lowercase, uppercase, and special character.
  - **Acceptance Test**: Submit button disabled until all checklist items green; HTTP 409 displays "Email already taken".
  - **Dependencies**: FE-1.2.

- [x] **FE-1.6**: Build Staff Management and Staff Creation modal (Admin only) [PDF 2, 8, 12].
  - **Input**: Staff email, role selector, `POST /users/staff`.
  - **Expected Output**: Staff directory table with invite/create staff modal.
  - **Acceptance Test**: Form submits to `/users/staff`; visible only to Admin users.
  - **Dependencies**: FE-1.3.

- [x] **FE-1.7**: Build Audit Log viewer screen with JSON diff viewer (Admin only) [PDF 2, 5.10, 12].
  - **Input**: `GET /api/v1/audit_logs` (or backend audit endpoint) with pagination.
  - **Expected Output**: Searchable audit table with expandable before/after JSON diff viewer.
  - **Acceptance Test**: Log entries render actor, entity, action, timestamp, and visual before/after changes.
  - **Dependencies**: FE-1.3.

---

## Phase 2: Catalog (Products, Variants, Plans, Taxes) [PDF 17]

- [x] **FE-2.1**: Build Products and Variants management screens with cost vs sales margin display [PDF 2, 5.3, 12].
  - **Input**: `GET/POST /products`, `GET/PATCH/DELETE /products/{id}`, `POST /products/{id}/variants`.
  - **Expected Output**: Product table with type chips, variant drawer, and margin calculation (`sales - cost`) visible only to Admin.
  - **Acceptance Test**: Staff cannot view cost margin or edit products; Admin can add variants with `extra_price`.
  - **Dependencies**: FE-1.3.

- [x] **FE-2.2**: Build Plans configuration screen with behavior toggle flags [PDF 2, 5.4, 12].
  - **Input**: `GET/POST /plans`, `PATCH /plans/{id}`.
  - **Expected Output**: Plan cards showing price, billing period (`daily`, `weekly`, `monthly`, `yearly`), min quantity, and flags (`auto_close`, `closable`, `pausable`, `renewable`, `is_active`).
  - **Acceptance Test**: Saving toggles persists to backend; Staff role sees read-only plan views.
  - **Dependencies**: FE-1.3.

- [x] **FE-2.3**: Build Tax Rules configuration screen [PDF 2, 5.7, 12].
  - **Input**: `GET/POST/PATCH /taxes`.
  - **Expected Output**: Tax table listing rules, percentage/fixed rate, inclusive boolean badge, and applicability tags (`all`, `product`, `category`).
  - **Acceptance Test**: Tax rate changes persist; inclusive vs exclusive badges render distinctly.
  - **Dependencies**: FE-1.3.

---

## Phase 3: Sales (Customers, Quotation Templates, Subscriptions) [PDF 17]

- [x] **FE-3.1**: Build Customer Directory and Customer Detail screen [PDF 2, 5.2, 12].
  - **Input**: `GET/POST /customers`, `GET/PATCH /customers/{id}`.
  - **Expected Output**: Searchable customer list and detail view with tabs for Subscriptions, Invoices, Payments.
  - **Acceptance Test**: Customer detail loads related subscriptions and invoices; inline address edit functions.
  - **Dependencies**: FE-1.3.

- [x] **FE-3.2**: Build Quotation Templates builder with one-click quotation generator [PDF 2, 5.5, 8, 12].
  - **Input**: `GET/POST /quotation-templates`, `POST /quotation-templates/{id}/create-quotation`.
  - **Expected Output**: Template editor with product line items, validity days, and a "Create Quotation" action button.
  - **Acceptance Test**: Clicking "Create Quotation" dispatches API request and navigates to newly generated subscription draft.
  - **Dependencies**: FE-2.1, FE-3.1.

- [x] **FE-3.3**: Build Subscriptions list screen with status chips and filter bar [PDF 5.6, 6.1, 12].
  - **Input**: `GET /subscriptions?status=&customer_id=&from=&to=`.
  - **Expected Output**: Virtualized table with colored status chips (`draft`, `quotation`, `confirmed`, `active`, `paused`, `closed`, `cancelled`).
  - **Acceptance Test**: Filtering by status and customer updates list within 300 ms debounce.
  - **Dependencies**: FE-1.3.

- [x] **FE-3.4**: Build Subscription Detail view with lifecycle status stepper and dynamic real-time line editor [PDF 5.6, 6.1, 7.1, 12].
  - **Input**: `GET /subscriptions/{id}`, `PATCH /subscriptions/{id}`.
  - **Expected Output**: Status stepper (`Draft -> Quotation -> Confirmed -> Active -> Closed`); real-time line editor dynamically recalculating line subtotal, estimated taxes, and document totals live as quantity/price change.
  - **Acceptance Test**: In Draft mode, totals recompute dynamically on keystroke with rounded 2-decimal sums; non-draft fields lock; negative values blocked inline.
  - **Dependencies**: FE-3.3.

- [x] **FE-3.5**: Implement Subscription Transition actions gated by plan behavior flags [PDF 5.4, 6.1, 8].
  - **Input**: `POST /subscriptions/{id}/transition`, `/pause`, `/resume`, `/close`, `/renew`.
  - **Expected Output**: Action buttons that conditionally render based on `plan.closable`, `plan.pausable`, and `plan.renewable`.
  - **Acceptance Test**: Pause button hidden if `plan.pausable == false`; Close button prompts for `close_reason`; 409 responses show error toast.
  - **Dependencies**: FE-3.4.

---

## Phase 4: Billing (Invoices, Discounts, Billing Job UI) [PDF 17]

- [x] **FE-4.1**: Build Discount Rules management screen (Admin only) [PDF 2, 5.8, 8, 12].
  - **Input**: `GET/POST/PATCH /discounts`, `GET /discounts/{id}/usage`.
  - **Expected Output**: Discount rules table with usage count vs usage limit indicator, type (percent/fixed), and date range.
  - **Acceptance Test**: Form validates min purchase amount and quantity; usage tracker reflects redemptions.
  - **Dependencies**: FE-1.3.

- [x] **FE-4.2**: Build Invoices list and detail screen with status flow [PDF 5.9, 6.2, 12].
  - **Input**: `GET /invoices`, `GET /invoices/{id}`.
  - **Expected Output**: Invoices table with balance and overdue badge; detail view showing line items, tax breakdown, and status stepper (`Draft -> Confirmed -> Paid`).
  - **Acceptance Test**: Cancel button hidden when status is `Paid`; overdue badge appears when `confirmed`, `balance > 0`, and `due_date < today`.
  - **Dependencies**: FE-1.3.

- [x] **FE-4.3**: Implement Invoice Actions (Confirm, Cancel, Send, Print, PDF Download) [PDF 6.2, 8, 12].
  - **Input**: `POST /invoices/{id}/confirm`, `/cancel`, `/send`, `GET /invoices/{id}/pdf`.
  - **Expected Output**: Interactive buttons for each invoice lifecycle action; PDF viewer/download trigger.
  - **Acceptance Test**: Sending invoice records `sent_at` timestamp; PDF download streams file or polls S3 URL.
  - **Dependencies**: FE-4.2.

- [x] **FE-4.4**: Build Manual Billing Run trigger and observability modal [PDF 5.10, 7.2, 8].
  - **Input**: `POST /billing/run` (Admin only).
  - **Expected Output**: Admin button "Run Billing Now" with modal displaying `created_count`, `skipped_count`, `failed_count`, `error_summary`.
  - **Acceptance Test**: Dispatching billing run updates modal with execution summary upon completion.
  - **Dependencies**: FE-1.3.

---

## Phase 5: Payments (Recording, Overdue Logic, Reminders) [PDF 17]

- [ ] **FE-5.1**: Build Payments Register table with filters [PDF 5.9, 8, 10, 12].
  - **Input**: `GET /payments?format=csv`.
  - **Expected Output**: Searchable table displaying payment date, invoice number, method, amount, reference, and reversal tags.
  - **Acceptance Test**: Reversals render in distinct styling with negative amounts; CSV export button downloads file.
  - **Dependencies**: FE-1.3.

- [ ] **FE-5.2**: Build Record Payment slide-over drawer with overpayment validation [PDF 5.9, 7.4, 8, 12].
  - **Input**: `POST /invoices/{id}/payments`, `Idempotency-Key` header.
  - **Expected Output**: Payment entry drawer with payment method dropdown (`card`, `upi`, `bank_transfer`, `cash`, `cheque`, `other`), amount validation against invoice balance.
  - **Acceptance Test**: Entering amount > balance is rejected with validation message; submit button disables during request to prevent duplicates.
  - **Dependencies**: FE-4.2.

- [ ] **FE-5.3**: Build Outstanding and Overdue screen with aging buckets and reminder trigger [PDF 7.5, 10, 12].
  - **Input**: `GET /reports/outstanding`, `GET /reports/overdue`.
  - **Expected Output**: View displaying aging buckets (`0-30`, `31-60`, `61-90`, `90+`) and overdue table with one-click "Send Reminder" button.
  - **Acceptance Test**: Clicking "Send Reminder" triggers notification dispatch and toasts success.
  - **Dependencies**: FE-4.2.

---

## Phase 6: Reports & Finance Dashboard [PDF 17]

- [ ] **FE-6.1**: Build Executive Finance Dashboard KPI summary grid [PDF 1, 10, 12].
  - **Input**: `GET /reports/summary`.
  - **Expected Output**: Grid of KPI cards: Active Subscriptions, MRR, ARR, Revenue Collected, Total Invoiced, Outstanding Amount, Overdue Count & Amount, New vs Closed Subscriptions.
  - **Acceptance Test**: MRR displays normalized monthly revenue; all currency figures right-aligned with currency code.
  - **Dependencies**: FE-1.3.

- [ ] **FE-6.2**: Build Financial Charts (Revenue Trend Line, Payments by Method, Aging Buckets) [PDF 10, 12].
  - **Input**: `GET /reports/revenue`, `GET /reports/payments`.
  - **Expected Output**: Interactive line chart for monthly revenue trends and donut/bar chart for payment methods.
  - **Acceptance Test**: Hovering charts reveals exact values; date range filter updates charts seamlessly.
  - **Dependencies**: FE-6.1.

- [ ] **FE-6.3**: Build Active Subscriptions and Revenue report tables with CSV export [PDF 8, 10, 12].
  - **Input**: `GET /reports/active-subscriptions?format=csv`, `GET /reports/revenue?format=csv`.
  - **Expected Output**: Filterable data tables with sortable columns and direct CSV export download triggers.
  - **Acceptance Test**: Clicking CSV export downloads valid formatted CSV file.
  - **Dependencies**: FE-6.1.

---

## Phase 7: Customer Portal & Polish [PDF 17]

- [ ] **FE-7.1**: Build Customer Portal layout and "My Subscriptions" view [PDF 1, 2, 8, 12].
  - **Input**: `GET /me/subscriptions`.
  - **Expected Output**: Customer-facing portal displaying active plan card, next billing date, status chip, and pause/cancel/upgrade request buttons.
  - **Acceptance Test**: Portal strictly displays rows where customer owns subscription; no administrative controls exposed.
  - **Dependencies**: FE-1.3.

- [ ] **FE-7.2**: Build Customer Portal "My Invoices" view with PDF download and "Pay Now" gateway checkout [PDF 2, 7.4, 8, 12].
  - **Input**: `GET /me/invoices`, `POST /me/invoices/{id}/pay`.
  - **Expected Output**: Invoices list with paid/outstanding badges, PDF download link, and "Pay Now" button initiating payment gateway modal with built-in sandbox/simulation toggle (avoiding excessive reliance on live third-party gateway APIs).
  - **Acceptance Test**: Successful gateway payment (live or simulated sandbox) updates invoice badge to Paid; receipt downloadable.
  - **Dependencies**: FE-7.1.

- [ ] **FE-7.3**: Build Customer Profile and Password management screen [PDF 2, 8, 12].
  - **Input**: `PATCH /me/profile`.
  - **Expected Output**: Profile editing form for billing address, phone, and password change.
  - **Acceptance Test**: Updates profile successfully; rejects weak password with rule checklist.
  - **Dependencies**: FE-7.1.

- [ ] **FE-7.4**: Implement Performance Optimizations (virtualization, code-splitting, skeleton loaders, debounce) [PDF 1, 11].
  - **Input**: Lazy-loaded routes, virtual table components, skeleton screens, 300 ms debounce hook.
  - **Expected Output**: Snappy user experience meeting the < 2s page load budget with thousands of records.
  - **Acceptance Test**: Lighthouse / performance audit confirms interactive render < 2.0 seconds.
  - **Dependencies**: All previous FE tasks.
