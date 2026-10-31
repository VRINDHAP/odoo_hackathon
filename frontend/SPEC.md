# Frontend Specification — Subscription Management System (Brightloop)

## 1. Product Goal and Scope [PDF 1]
- Build a unified single-page application (SPA) running the entire subscription lifecycle: catalog -> quotation -> subscription -> invoice -> payment -> reporting [PDF 1].
- Provide distinct role-based views for Admin, Internal Staff, and Customers (Portal) [PDF 1].
- Ensure every view with thousands of subscriptions loads in under 2 seconds [PDF 1, 11].
- Provide a single finance view containing active subscriptions, revenue, payments, overdue invoices, and filters [PDF 1, 10].
- Present invoice status with paid, outstanding, and overdue amounts always visible [PDF 1, 5.9].

---

## 2. Actors and Access Control (RBAC) [PDF 2]
The frontend implements Layer 1 (Route Guard) and Layer 2 (Menu & Action Gating) of the 3-layer RBAC architecture [PDF 2]. Server remains the ultimate authority [PDF 12].

### Role Permission Matrix [PDF 2]
| Capability | Admin | Internal Staff | Customer (Portal) | UI Enforcement Rule |
| :--- | :--- | :--- | :--- | :--- |
| Create staff accounts | Yes | No | No | Visible only to Admin in Settings/Staff menu [PDF 2] |
| Products, variants, plans CRUD | Yes | Read only | Read (own plan) | Admin: full edit forms; Staff: view-only tables; Portal: read current plan card [PDF 2] |
| Taxes, discount rules CRUD | Yes | Read only | No | Admin: full edit; Staff: read-only; Portal: hidden [PDF 2] |
| Quotation templates | Yes | Create/use | No | Admin/Staff: create/use templates; Portal: hidden [PDF 2] |
| Customers CRUD | Yes | Yes | Own profile only | Admin/Staff: full directory; Portal: strictly `/me/profile` [PDF 2, 8] |
| Subscriptions create/edit/transition | Yes | Yes (no delete) | View own, request cancel/upgrade | Admin/Staff: full lifecycle; Staff delete button disabled; Portal: view own + request buttons [PDF 2] |
| Invoices confirm/cancel/send/print | Yes | Yes | View/download own, pay | Admin/Staff: action buttons; Portal: download PDF + Pay Now button [PDF 2] |
| Record payments | Yes | Yes | Pay own invoices | Admin/Staff: Record Payment drawer; Portal: online gateway checkout [PDF 2] |
| Reports and dashboard | Yes | Limited (operational) | No | Admin: financial KPIs (MRR/ARR); Staff: operational lists; Portal: hidden [PDF 2] |
| Audit log, system settings | Yes | No | No | Hidden for Staff and Customer [PDF 2] |

---

## 3. Architecture [PDF 3]
- **Client Architecture**: React SPA built with Vite [PDF 3].
- **Transport**: HTTPS with JSON payloads; Bearer JWT tokens attached in `Authorization` header [PDF 3].
- **Proxy**: Ingress via reverse proxy (Nginx) terminating SSL and routing to backend `/api/v1` [PDF 3, 8].
- **Layering Rule**: UI components must never compute core financial math, tax logic, discount redemption, or state transitions; UI displays data and delegates actions to API [PDF 3].
- **Hackathon Database & Backend Standard**: The SPA interfaces exclusively with a relational SQL backend powered by PostgreSQL 16+ (or MySQL 8+). Direct integration with NoSQL or BaaS platforms (Firebase Firestore, Realtime Database, MongoDB, Supabase client-side SDKs) is strictly prohibited.
- **Minimal Third-Party API Footprint**:
  - Auth is handled purely through the internal backend API (`/auth/login`, `/auth/signup`) using JWT tokens (no Firebase Auth, Clerk, or Google Identity third-party SDK dependencies).
  - Online checkout interfaces via internal sandbox/mock gateway modes alongside Razorpay/Stripe client forms, allowing seamless evaluation without external gateway API keys or active internet access.
  - PDF previews and downloads stream directly from the backend endpoint (`/invoices/{id}/pdf`) without external cloud PDF viewing widgets.

---

## 4. Module Breakdown (Frontend Scope) [PDF 4]
The UI must implement client screens and components for 12 system modules [PDF 4]:
1. **Auth and Users**: Login, signup, password reset flow, token refresh, staff creation form [PDF 4, 12].
2. **Customers**: Customer directory, profile view, billing address form, linked portal user status [PDF 4, 12].
3. **Catalog**: Products table, variant drawer, cost vs sales price (margin visible to admin only) [PDF 4, 5.3].
4. **Plans**: Plan cards and forms, billing period selectors, plan behavior flags [PDF 4, 5.4].
5. **Quotation Templates**: Template list, line item builder, one-click create quotation button [PDF 4, 5.5].
6. **Subscriptions**: Subscription list, stepper, line editor, activity timeline, action buttons [PDF 4, 6.1, 12].
7. **Tax**: Tax rules table, inclusive/exclusive badge, rate percentage editor [PDF 4, 5.7].
8. **Discounts**: Discount rules table (admin write), usage progress bar [PDF 4, 5.8].
9. **Billing/Invoices**: Invoices table, invoice detail view, print view, PDF trigger, status stepper [PDF 4, 5.9, 6.2].
10. **Payments**: Payments register table, Record Payment slide-over drawer, refund/reversal indicator [PDF 4, 5.9, 7.4].
11. **Reports**: Executive finance dashboard, KPI cards, trend lines, payment breakdown, aging buckets, CSV export [PDF 4, 10].
12. **Notifications & Audit**: Notification list, audit history table (before/after JSON diffs) [PDF 4, 5.10].

---

## 5. Data Model Display & Input Rules [PDF 5]
All monetary numbers must be formatted from `NUMERIC(14,2)` values, right-aligned, and accompanied by the document currency code [PDF 5, 12].

### 5.1 Identity Fields [PDF 5.1]
- `email`: lowercased string [PDF 5.1].
- `role`: Enum `admin | staff | customer` [PDF 5.1].
- `failed_attempts`: Integer counter [PDF 5.1].
- `locked_until`: Timestamp display [PDF 5.1].
- `last_login_at`: Timestamp display [PDF 5.1].

### 5.2 Customer Fields [PDF 5.2]
- `name`, `email`, `phone`, `company_name`, `tax_id`, `billing_address` (JSON or separate fields), `status` [PDF 5.2].

### 5.3 Catalog & Products [PDF 5.3]
- Product `type`: Enum `service | software | addon | physical` [PDF 5.3].
- `sales_price`, `cost_price`: Formatted as currency `NUMERIC(14,2)` [PDF 5, 5.3].
- Admin-only view: Margin = `sales_price - cost_price` [PDF 5.3].
- Product Variants: `attribute` (e.g. Brand), `value` (e.g. Odoo), `extra_price` [PDF 5.3].
- Effective unit price displayed = `product.sales_price + variant.extra_price` [PDF 5.3].

### 5.4 Plans & Behavior Flags [PDF 5.4]
- `billing_period`: Enum `daily | weekly | monthly | yearly` [PDF 5.4].
- `min_quantity`: Positive integer [PDF 5.4].
- `valid_from`, `valid_to`: Date pickers [PDF 5.4].
- Admin-configurable flags: `auto_close` (bool), `closable` (bool), `pausable` (bool), `renewable` (bool), `is_active` (bool) [PDF 5.4].
- UI Button Gating Rule: The UI shows Close, Pause, and Renew buttons on a subscription only if the corresponding plan flag is `true` [PDF 5.4, 6.1].

### 5.5 Quotation Templates [PDF 5.5]
- `name`, `validity_days`, `plan_id`, `notes` [PDF 5.5].
- Lines: `product_id`, `variant_id`, `quantity`, `unit_price` [PDF 5.5].

### 5.6 Subscriptions [PDF 5.6]
- `number`: Formatted string (e.g. `SUB-2026-000123`) [PDF 5.6].
- `status`: Enum `draft | quotation | confirmed | active | paused | closed | cancelled` [PDF 5.6, 6.1].
- Dates: `start_date`, `expiry_date`, `next_billing_date`, `last_billed_through`, `quote_valid_until`, `paused_at`, `closed_at` [PDF 5.6].
- Payment Terms: Enum/Lookup `Immediate`, `Net 15`, `Net 30` [PDF 5.6].
- Money Totals: `subtotal`, `discount_total`, `tax_total`, `total` [PDF 5.6].
- Line Items: Snapshot `unit_price`, `quantity`, `line_subtotal`, `line_tax`, `line_total` [PDF 5.6].

### 5.7 Taxes [PDF 5.7]
- `name` (e.g. GST 18%), `type` (`percent | fixed`), `rate`, `inclusive` (bool), `applies_to` (`all | product | category`), `is_active` [PDF 5.7].

### 5.8 Discounts [PDF 5.8]
- `name`, `type` (`percent | fixed`), `value`, `min_purchase_amount`, `min_quantity`, `start_date`, `end_date`, `usage_limit`, `usage_count`, `scope` (`product | subscription`), `is_active` [PDF 5.8].

### 5.9 Invoices & Payments [PDF 5.9, 5.10]
- Invoice `status`: Enum `draft | confirmed | paid | cancelled` [PDF 5.9, 6.2].
- Amounts: `subtotal`, `discount_total`, `tax_total`, `total`, `amount_paid`, `balance` [PDF 5.9].
- Derived Status Badge: Overdue must be displayed whenever `status == 'confirmed'` AND `balance > 0` AND `due_date < today` [PDF 5.9].
- Payment `method`: Enum `card | upi | bank_transfer | cash | cheque | other` [PDF 5.9].
- Reversals: Negative amount entries flagged as Reversals with required reason text [PDF 7.4].

---

## 6. State Machines & UI Interaction [PDF 6]

### 6.1 Subscription Lifecycle Stepper [PDF 6.1]
Display a horizontal visual stepper on the subscription detail page:
`Draft` -> `Quotation` -> `Confirmed` -> `Active` -> `Closed` [PDF 6.1].
Additional branches:
- `Active` <-> `Paused` (Bidirectional pause/resume) [PDF 6.1].
- `Closed` -> `Active` (Renewal action) [PDF 6.1].
- `Quotation` or `Confirmed` -> `Cancelled` (Cancellation before Active) [PDF 6.1].

#### Action Buttons & UI Transition Rules [PDF 6.1]
| Current State | Target Action | Who Can Trigger | Frontend Validation Before Dispatch |
| :--- | :--- | :--- | :--- |
| `Draft` | Send Quotation | Staff / Admin | Require customer selected, plan selected, >= 1 line item, line quantity >= `plan.min_quantity` [PDF 6.1] |
| `Quotation` | Confirm Order | Staff / Admin / Customer | Check `today <= quote_valid_until`; alert if quote expired [PDF 6.1] |
| `Confirmed` | Activate | System / Staff | Allowed manually or scheduled; prompts confirmation [PDF 6.1] |
| `Active` | Pause | Staff / Admin | Show button ONLY IF `plan.pausable == true`. Show warning: "Billing skips paused periods" [PDF 6.1, 5.4] |
| `Paused` | Resume | Staff / Admin | Trigger `/resume`; notifies that next billing date will be recomputed [PDF 6.1, 7.2] |
| `Active` | Close | Staff / Admin | Show button ONLY IF `plan.closable == true`. Prompt for mandatory `close_reason` [PDF 5.6, 6.1] |
| `Closed` | Renew | Staff / Admin | Show button ONLY IF `plan.renewable == true`. Creates new term [PDF 6.1] |
| Any | Illegal Transition | Any | Intercept HTTP 409 response and display error toast with server explanation [PDF 6.1, 8] |

### 6.2 Invoice Status Flow & Actions [PDF 6.2]
- Stepper: `Draft` -> `Confirmed` -> `Paid` [PDF 6.2].
- Cancellation: Allowed from `Draft` or `Confirmed` into `Cancelled` [PDF 6.2].
- Hard Constraint: Invoices in `Paid` status cannot be cancelled; UI hides the cancel button and suggests Credit Note [PDF 6.2].
- Actions (not states): `Send` (records `sent_at`), `Print` / `Download PDF` (fetches `/invoices/{id}/pdf`) [PDF 6.2, 8].

---

## 7. Business Logic UI Requirements [PDF 7]

### 7.1 Line Pricing Display [PDF 7.1]
- In `Draft` mode, allow staff to override line `unit_price` [PDF 7.1].
- Display line subtotal = `quantity * unit_price` [PDF 7.1].
- Display discount applied to determine taxable amount [PDF 7.1].
- Display tax breakdown (inclusive vs exclusive) [PDF 7.1].
- Rounding display: Display each line rounded to 2 decimal places (half-up); document total must display the exact sum of displayed lines [PDF 7.1].

### 7.2 Manual Billing Run Trigger [PDF 7.2]
- Admin Dashboard provides a "Run Billing Now" button calling `POST /api/v1/billing/run` [PDF 7.2, 8].
- Display progress modal showing `billing_runs` summary: `created_count`, `skipped_count`, `failed_count`, `error_summary` [PDF 5.10, 7.2].

### 7.3 Discount Application Display [PDF 7.3]
- Display applied discount type: Percent (`subtotal * value / 100`) or Fixed (`min(value, subtotal)`) [PDF 7.3].
- If multiple discounts eligible, backend applies the best single discount; UI shows active discount badge [PDF 7.3].

### 7.4 Payments Interface [PDF 7.4]
- Payment is attached to exactly one invoice [PDF 7.4].
- Support partial payments: input field defaults to invoice `balance` but allows lower amounts [PDF 7.4].
- Block overpayment: client form validation prevents entering amount > `invoice.balance` (unless store credit enabled) [PDF 7.4].
- Record Payment Drawer: captures `method`, `amount`, `payment_date`, `reference`, `note` [PDF 5.9, 12].
- Append-only view: payments cannot be edited; reversals shown as separate negative rows [PDF 7.4].
- Customer Portal Online Payment: integrates PaymentProvider (Razorpay/Stripe checkout modal) [PDF 7.4].

### 7.5 Overdue & Dunning UI [PDF 7.5]
- Highlight overdue invoices with red status badges [PDF 7.5].
- Provide Aging Buckets breakdown widget: `0-30 days`, `31-60 days`, `61-90 days`, `90+ days` [PDF 7.5, 10].
- Provide one-click "Send Reminder" button on overdue invoice rows [PDF 10].

---

## 8. API Integration & Form Validation [PDF 8]

### Request Conventions [PDF 8]
- Base URL: `/api/v1` [PDF 8].
- Query pagination: `?page=1&page_size=25` or cursor keyset parameters [PDF 8, 11].
- Query filters: `?status=&customer_id=&from=&to=&format=csv` [PDF 8, 10].
- Idempotency Header: Include header `Idempotency-Key: <UUIDv4>` on all POST requests to `/invoices/{id}/payments` and `/invoices` [PDF 8, 16].
- Standard Error Handling: Intercept error body `{ "code": string, "message": string, "fields": [{ "field": string, "message": string }] }` and highlight corresponding input fields [PDF 8].

### Signup Form Validation Rules [PDF 8, 12]
- **Email Validation**: Case-insensitive format, check uniqueness (handle HTTP 409) [PDF 8].
- **Password Strength Rules**: Length > 8 (minimum 9 characters), at least one uppercase letter, at least one lowercase letter, at least one special character [PDF 8].
- **Regex Enforcement**: `^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$` [PDF 8].
- **Interactive UI**: Live password-rule checklist turning green dynamically as user types [PDF 12].

---

## 9. Authentication, Security & Privacy UX [PDF 9]
- **Token Storage**: JWT access token (15-min expiry) in memory/secure storage; rotating refresh token (7-day expiry) handled via HTTP-only cookie or secure refresh service [PDF 9].
- **Silent Refresh**: Axios/Fetch interceptor triggers `POST /auth/refresh` on 401 response; on failure redirect to `/login` [PDF 8, 9].
- **Forgot Password UX**: Display constant message: *"If the email exists, a link was sent"* to prevent account enumeration [PDF 9].
- **Account Lockout Alert**: Inform user if account is locked after repeated login failures [PDF 9].
- **Role Isolation**: Public signup form creates only Customer role; Admin and Staff account creation restricted to Admin screen [PDF 9].
- **Customer Privacy**: Customer Portal only queries `/me/*` routes; never display data belonging to other customers [PDF 9].

---

## 10. Reporting and Finance Dashboard Views [PDF 10]

### Single Finance View (Admin & Authorized Staff) [PDF 1, 10]
1. **Summary KPI Cards**:
   - Active Subscriptions count [PDF 10]
   - MRR (Monthly Recurring Revenue) and ARR (Annual Recurring Revenue) [PDF 10]
     - Normalization formula: Monthly = x1, Yearly = /12, Weekly = x52/12, Daily = x365/12 summed over Active subscriptions (Paused excluded) [PDF 10]
   - Revenue Collected (for selected period) [PDF 10]
   - Total Invoiced [PDF 10]
   - Outstanding Amount [PDF 10]
   - Overdue Invoice Count and Amount [PDF 10]
   - New vs Closed Subscriptions count [PDF 10]
   - Payments by Method breakdown [PDF 10]
2. **Interactive Visualizations**:
   - Revenue trend line chart [PDF 10]
   - Payments by method pie/bar chart [PDF 10]
   - Aging buckets visualization (0-30, 31-60, 61-90, 90+) [PDF 10]
3. **Data Tables (with Filters, Sort, Search, Pagination, CSV/PDF Export)**:
   - Active Subscriptions table (filters: plan, customer, date range, status) [PDF 10]
   - Revenue table by month, plan, product [PDF 10]
   - Outstanding and Overdue invoices table with one-click "Send Reminder" button [PDF 10]
   - Payments register table with method and date range filters [PDF 10]

---

## 11. Performance & Usability Engineering [PDF 1, 11]
- **Page Load Budget**: Every page must load in under 2 seconds with thousands of subscriptions [PDF 1, 11].
- **Code Splitting**: Route-level dynamic imports (`React.lazy`) for Admin, Staff, and Customer modules [PDF 11].
- **List Virtualization**: Implement virtual scroll rendering (e.g. TanStack Virtual / react-window) for tables with > 100 rows [PDF 11].
- **Debounced Search**: Apply 300 ms debounce on table search inputs before firing API query [PDF 11].
- **Skeleton Loaders**: Render skeleton placeholders during data fetching to eliminate visual layout shifts [PDF 11].
- **Server Pagination**: Never fetch unbounded lists; consume server pagination metadata (`page`, `page_size`, `total_pages`) [PDF 11].
- **Async Polling / Notification**: For heavy operations (billing run, bulk CSV export, PDF render), trigger background job and poll status or listen for notification [PDF 11, 13].

---

## 12. Screen-by-Screen Specification [PDF 12]

### 12.1 Public Screens [PDF 12]
- `Landing / Login`: Clean email & password inputs, remember me, forgot password link [PDF 12].
- `Sign Up`: Name, email, company, password input with real-time live password-rule checklist [PDF 12].
- `Forgot / Reset Password`: Request reset link screen and password set screen [PDF 12].

### 12.2 Admin and Staff Application [PDF 12]
- `Dashboard`: Executive KPI grid, trend charts, aging buckets, quick action shortcuts [PDF 10, 12].
- `Customers`:
  - List View: Table with search, status filters, sort [PDF 12].
  - Detail View: Customer profile card, Subscriptions tab, Invoices tab, Payments tab [PDF 12].
- `Products & Variants`: Product list, product creation modal, variant manager (Brand, Value, Extra Price), cost vs sales price (margin visible to Admin only) [PDF 5.3, 12].
- `Plans`: Plan cards, pricing, interval selector, min quantity, behavior toggles (`auto_close`, `closable`, `pausable`, `renewable`) [PDF 5.4, 12].
- `Taxes`: Tax rules table, inclusive/exclusive toggle, rate input [PDF 5.7, 12].
- `Discounts (Admin Only)`: Rules list, creation modal (scope, limits, dates), usage tracker [PDF 5.8, 12].
- `Quotation Templates`: Template table, line builder, "Create Quotation" action button [PDF 5.5, 12].
- `Subscriptions`:
  - List View: Status chips, customer filter, plan filter, renewal dates [PDF 12].
  - Detail View: Status stepper (`Draft` -> `Quotation` -> `Confirmed` -> `Active` -> `Closed`), editable line items table (in draft), timeline activity log, action buttons (Close, Pause, Renew gated by plan flags) [PDF 6.1, 12].
- `Invoices`:
  - List View: Status badges, overdue flags, balance column, filter bar [PDF 12].
  - Detail View: Document layout, line item breakdown, tax & discount lines, Confirm / Cancel / Send / Print / PDF buttons [PDF 6.2, 12].
- `Payments`:
  - Register Table: Method, date, reference, status, reversal tags [PDF 12].
  - Record Payment Drawer: Slide-over form with invoice lookup, amount (with balance validation), method, date, reference [PDF 12].
- `Reports`: Comprehensive reports dashboard with CSV export buttons [PDF 10, 12].
- `Staff Management (Admin Only)`: Staff directory, invite staff modal with role assignment [PDF 2, 12].
- `Audit Log (Admin Only)`: Searchable log with actor, action, timestamp, expandable JSON diff (before vs after) [PDF 5.10, 12].
- `Settings`: Company details, currency code, invoice number prefix, reminder schedule [PDF 5.10, 12].

### 12.3 Customer Portal [PDF 12]
- `My Subscriptions`: Cards showing active plan, status chip, start date, next billing date, and request buttons (pause/cancel/upgrade where allowed) [PDF 12].
- `My Invoices`: Table with invoice date, due date, amount, paid/outstanding badges, Download PDF link, and "Pay Now" button [PDF 12].
- `Payment History`: Table of past payments, receipts, and payment method [PDF 12].
- `Profile and Password`: Update billing address, change password [PDF 8, 12].

### 12.4 UX Consistency, Color System & Robust Validation Rules [PDF 12]
- **Curated, Consistent Color Palette**:
  - Base theme tokens defined in CSS root: `--bg-primary: #0f172a` (dark) or `#f8fafc` (light), `--card-bg: #ffffff`, `--border-color: #e2e8f0`, `--text-primary: #0f172a`, `--text-secondary: #64748b`.
  - Semantic Status Chips & Stepper Palette:
    - `Draft`: Neutral Slate (Text: `#475569`, Background: `#f1f5f9`, Border: `#cbd5e1`).
    - `Quotation`: Amber / Warning (Text: `#b45309`, Background: `#fef3c7`, Border: `#fde68a`).
    - `Confirmed`: Blue / Info (Text: `#1d4ed8`, Background: `#dbeafe`, Border: `#bfdbfe`).
    - `Active`: Emerald / Success (Text: `#047857`, Background: `#d1fae5`, Border: `#a7f3d0`).
    - `Paused`: Orange / Notice (Text: `#c2410c`, Background: `#ffedd5`, Border: `#fed7aa`).
    - `Closed`: Purple / Completed (Text: `#6b21a8`, Background: `#f3e8ff`, Border: `#e9d5ff`).
    - `Cancelled`: Rose / Danger (Text: `#be123c`, Background: `#ffe4e6`, Border: `#fecdd3`).
- **Dynamic & Real-Time Data Recalculation**:
  - Live line editing in Draft mode: changing quantity or unit price dynamically recalculates line subtotal, estimated taxes, eligible discount deductions, and totals without needing page reload or server round-trip [PDF 7.1, 12].
  - Live password rule checklist: ticks update in real-time as keystrokes meet length (>8), uppercase, lowercase, and special character conditions [PDF 8, 12].
  - Real-time job observability: background billing runs and PDF generation display active progress loaders and dynamically refresh state upon completion [PDF 11, 13].
- **Robust Client-Side Input Validation**:
  - Inline error feedback beneath every field; red highlight borders and immediate validation on blur and submit [PDF 8, 12].
  - Impossible values blocked at UI layer: negative unit prices, line quantities below `plan.min_quantity`, payment amounts exceeding invoice `balance` [PDF 5.4, 7.4].
  - Error schema mapping: server error responses `{ "fields": [{ "field": "...", "message": "..." }] }` highlight and attach directly to the offending form control [PDF 8].
- **General UX Principles**:
  - Status must always be rendered as a colored chip + state stepper [PDF 12].
  - Destructive actions (Cancel invoice, Close subscription, demote user) require explicit modal confirmation [PDF 12].
  - Financial amounts must be right-aligned with currency code prefix/suffix [PDF 12].
  - Empty states render with descriptive typography and clear call-to-action buttons [PDF 12].
  - Fully responsive across desktop (>= 1280px), tablet (768px - 1279px), and mobile (< 768px) [PDF 12].

---

## 13. Background Job & Notification Status in UI [PDF 13]
- Display in-app toast notification or banner when background jobs complete (e.g. Billing Run completed, CSV export ready for download) [PDF 11, 13].
- Polling mechanism for invoice PDF generation: show spinner while PDF is generating in background, transition to Download button when `pdf_url` is populated [PDF 11, 13].

---

## 14. Frontend Source Directory Layout [PDF 14]
```text
frontend/
├── src/
│   ├── app/                    # Routing, Route Guards, App Layout [PDF 14]
│   ├── features/               # Module-specific views & state [PDF 14]
│   │   ├── auth/               # Login, Signup, Password Reset
│   │   ├── customers/          # Directory, Customer Detail
│   │   ├── catalog/            # Products, Variants
│   │   ├── plans/              # Plans Management
│   │   ├── templates/          # Quotation Templates
│   │   ├── subscriptions/      # Subscriptions List, Detail, Stepper
│   │   ├── taxes/              # Tax Rules
│   │   ├── discounts/          # Discounts (Admin)
│   │   ├── invoices/           # Invoices List, Detail, Print
│   │   ├── payments/           # Payments Register, Drawer
│   │   ├── reports/            # Dashboard, Trends, Aging
│   │   ├── portal/             # Customer Portal Screens
│   │   ├── audit/              # Audit Logs Viewer (Admin)
│   │   └── settings/           # System Settings
│   ├── components/             # Reusable UI library [PDF 14]
│   │   ├── tables/             # Virtualized / Paginated Data Tables
│   │   ├── forms/              # Input fields, Steppers, Validators
│   │   ├── chips/              # Status Chips & Badges
│   │   └── charts/             # Revenue Trend & Aging Charts
│   ├── api/                    # Axios/Fetch client, interceptors, endpoints [PDF 14]
│   ├── hooks/                  # Custom hooks (auth, pagination, debounce) [PDF 14]
│   └── utils/                  # Currency formatting, date math, validators [PDF 14]
├── index.html
├── package.json
└── vite.config.ts
```

---

## 15. Testing and Observability [PDF 15]
- **Unit Tests**: Form validation logic, live password strength validator regex, currency formatting, MRR calculation helper [PDF 15].
- **Integration Tests**: Login -> Token storage -> Route guard navigation; Customer portal profile edit isolation [PDF 15].
- **E2E Flow Validation**: Complete flow: Customer Signup -> Staff creates Template -> Quotation -> Customer approves -> Active -> Invoiced -> Paid [PDF 15].
- **Performance Budget**: Load test using Lighthouse/k6 to verify DOM paint and interactive response < 2s [PDF 11, 15].

---

## 16. Edge Cases in UI [PDF 16]
- **Plan Price Change**: When plan price changes in catalog, existing subscription detail shows snapshot unit price [PDF 16].
- **Minimum Quantity Guard**: Subscription line quantity input prevents decrementing below `plan.min_quantity` [PDF 16].
- **Discount Expiry**: If a discount expires before invoice creation, inform user that discounts are evaluated at invoice generation date [PDF 16].
- **Cancelled Invoice Discount**: If an invoice is cancelled, display that discount redemption has been released [PDF 16].
- **Paused Subscription Banner**: Paused subscriptions display a prominent banner: *"Paused: No billing runs will occur"* [PDF 16].
- **Duplicate Payment Prevention**: UI disables payment submit button on click and passes a generated UUIDv4 `Idempotency-Key` [PDF 8, 16].
- **Soft Deleted Customers**: Soft-deleted customers marked with inactive chip; historic invoices and subscriptions remain browsable [PDF 16].
- **Timezone Notice**: Dates displayed in company configured timezone with UTC tooltip [PDF 16].

---

## 17. Delivery Plan Mapping [PDF 17]
- **Phase 1**: Auth screens, route guards, staff management UI, audit viewer [PDF 17].
- **Phase 2**: Products, variants, plans, tax management screens [PDF 17].
- **Phase 3**: Customer directory, quotation templates, subscription management with stepper [PDF 17].
- **Phase 4**: Invoices list/detail, discount rules UI, manual billing run trigger [PDF 17].
- **Phase 5**: Payments register, record payment drawer, overdue aging badges, reminder button [PDF 17].
- **Phase 6**: Finance dashboard, KPI cards, charts, CSV exports [PDF 17].
- **Phase 7**: Customer portal screens, performance tuning, virtualized lists, skeleton loaders [PDF 17].

---

## 18. Ideal Additions Beyond the Brief (Frontend Placeholders) [PDF 18]
- Credit notes & refunds display on invoice detail [PDF 18].
- Subscription upgrade/downgrade proration preview modal [PDF 18].
- Auto-retry payment indicator [PDF 18].
- Multi-currency currency switcher dropdown [PDF 18].
- Coupon code input field at quotation stage [PDF 18].

---

## Open Questions & Ambiguities [PDF Rules]
1. **Anchor Day Display [PDF 7.2 vs 5.6]**: Section 7.2 specifies an `anchor_day` on the subscription to prevent month-end drift in February, but `anchor_day` is omitted from the low-level table in Section 5.6. Should the frontend display or allow editing of `anchor_day` on the subscription form?
2. **Customer Upgrade/Cancel Request Workflow [PDF 2, 12]**: Section 2 and 12 state customers can "request cancel/upgrade" in the portal. Is this an internal ticket/notification or does it trigger an automated subscription status transition?
3. **Credit Storage for Overpayment [PDF 7.4]**: Section 7.4 notes overpayment is "blocked (or stored as credit if enabled)". Should the UI present a toggle to store excess payment as customer credit?
