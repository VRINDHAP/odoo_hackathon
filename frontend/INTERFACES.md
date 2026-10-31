# Frontend Interfaces — Subscription Management System (Brightloop)

## 1. What Frontend Needs from Backend (`/backend`)

### 1.1 OpenAPI 3.0 Contract & Mock Server [PDF 8, 14]
Frontend requires the backend team to supply and maintain the `openapi.yaml` specification located in `backend/INTERFACES.md` before coding begins, enabling mock testing via MSW or Prism.

### 1.2 Authentication & Security Interfaces [PDF 8, 9]
- `POST /api/v1/auth/login`: Accepts `{ "email": string, "password": string }`. Returns `{ "access_token": string, "token_type": "bearer", "expires_in": 900, "user": { "id": string, "email": string, "role": "admin" | "staff" | "customer", "customer_id": string | null } }`.
- `POST /api/v1/auth/signup`: Accepts `{ "email": string, "password": string, "name": string, "company_name"?: string }`.
- `POST /api/v1/auth/refresh`: Accepts refresh token (in cookie or body). Returns new access token.
- `POST /api/v1/auth/forgot-password`: Accepts `{ "email": string }`. Returns `{ "message": "If the email exists, a link was sent" }` [PDF 9].
- `POST /api/v1/auth/reset-password`: Accepts `{ "token": string, "new_password": string }`.

### 1.3 Core REST Endpoints Consumed [PDF 8]
| HTTP Method | Route | Query / Body Params | Response Expected by Frontend |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/users/staff` | `{ "email": string, "role": "staff" }` | Created staff user object [PDF 8] |
| `GET` | `/api/v1/customers` | `?page=&page_size=&status=&search=` | Paginated customers list with total count [PDF 8] |
| `GET` | `/api/v1/customers/{id}` | Path param `id` | Customer details with nested tabs data [PDF 8] |
| `GET` / `POST` | `/api/v1/products` | Body: `{ name, type, sales_price, cost_price, tax_id, notes }` | Product list / created product [PDF 8] |
| `POST` | `/api/v1/products/{id}/variants` | Body: `{ attribute, value, extra_price }` | Created variant object [PDF 5.3, 8] |
| `GET` / `POST` | `/api/v1/plans` | Body: `{ name, price, billing_period, min_quantity, valid_from, valid_to, auto_close, closable, pausable, renewable }` | Plans list / created plan [PDF 5.4, 8] |
| `GET` / `POST` | `/api/v1/quotation-templates` | Body: `{ name, validity_days, plan_id, notes, lines: [...] }` | Template object [PDF 5.5, 8] |
| `POST` | `/api/v1/quotation-templates/{id}/create-quotation` | Path param `id` | Created `draft` subscription object [PDF 8] |
| `GET` / `POST` | `/api/v1/subscriptions` | Body: `{ customer_id, plan_id, lines: [...] }` | Paginated subscriptions list / created subscription [PDF 8] |
| `POST` | `/api/v1/subscriptions/{id}/transition` | Body: `{ "target": string }` | Updated subscription object (or 409 error) [PDF 6.1, 8] |
| `POST` | `/api/v1/subscriptions/{id}/pause` | Empty body | Updated subscription in `paused` state [PDF 8] |
| `POST` | `/api/v1/subscriptions/{id}/resume` | Empty body | Updated subscription in `active` state with recomputed `next_billing_date` [PDF 6.1, 8] |
| `POST` | `/api/v1/subscriptions/{id}/close` | Body: `{ "close_reason": string }` | Updated subscription in `closed` state [PDF 5.6, 6.1, 8] |
| `POST` | `/api/v1/subscriptions/{id}/renew` | Empty body | Renewed subscription with new term [PDF 6.1, 8] |
| `GET` / `POST` | `/api/v1/taxes` | Body: `{ name, type, rate, inclusive, applies_to }` | Taxes list / created tax rule [PDF 5.7, 8] |
| `GET` / `POST` | `/api/v1/discounts` | Body: `{ name, type, value, min_purchase_amount, min_quantity, start_date, end_date, usage_limit, scope, product_ids }` | Discounts list / created discount rule [PDF 5.8, 8] |
| `GET` | `/api/v1/invoices` | `?page=&page_size=&status=&customer_id=&from=&to=` | Paginated invoices list [PDF 8] |
| `POST` | `/api/v1/invoices/{id}/confirm` | Path param `id` | Invoice in `confirmed` status [PDF 6.2, 8] |
| `POST` | `/api/v1/invoices/{id}/cancel` | Path param `id` | Invoice in `cancelled` status (releases discount) [PDF 6.2, 7.3] |
| `POST` | `/api/v1/invoices/{id}/send` | Path param `id` | Invoice with updated `sent_at` timestamp [PDF 6.2, 8] |
| `GET` | `/api/v1/invoices/{id}/pdf` | Path param `id` | Binary PDF stream or redirect to S3 URL [PDF 8, 11] |
| `POST` | `/api/v1/billing/run` | Empty body (Admin only) | Billing run execution summary (`created_count`, `skipped_count`, `failed_count`, `error_summary`) [PDF 5.10, 8] |
| `GET` | `/api/v1/payments` | `?page=&page_size=&format=csv` | Paginated payments list or CSV download [PDF 8, 10] |
| `POST` | `/api/v1/invoices/{id}/payments` | Header: `Idempotency-Key`. Body: `{ method, amount, payment_date, reference, note }` | Recorded payment object; invoice with updated balance [PDF 5.9, 7.4, 8] |
| `GET` | `/api/v1/reports/summary` | Query date range | Dashboard KPIs (active subscriptions, MRR, ARR, revenue, outstanding, overdue, new/closed) [PDF 10] |
| `GET` | `/api/v1/reports/*` | `?format=csv` | CSV streaming file response [PDF 8, 10] |
| `GET` | `/api/v1/me/subscriptions` | Customer Portal Bearer token | List of customer's own subscriptions [PDF 8, 9] |
| `GET` | `/api/v1/me/invoices` | Customer Portal Bearer token | List of customer's own invoices [PDF 8, 9] |
| `POST` | `/api/v1/me/invoices/{id}/pay` | Customer Portal Bearer token | Gateway checkout session payload (Stripe/Razorpay) [PDF 7.4, 8] |
| `PATCH` | `/api/v1/me/profile` | Customer Portal Bearer token | Updated customer profile [PDF 8] |

### 1.4 Standard Error Response Contract [PDF 8]
Frontend expects all HTTP 4xx/5xx errors to adhere strictly to:
```json
{
  "code": "VALIDATION_ERROR | CONFLICT | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | RATE_LIMITED",
  "message": "Human readable error summary",
  "fields": [
    {
      "field": "password",
      "message": "Password must contain at least 9 characters with uppercase, lowercase, and special character"
    }
  ]
}
```

---

## 2. What Frontend Gives to Backend (`/backend`)
1. **HTTP Headers**:
   - `Authorization: Bearer <access_token>` on all guarded routes [PDF 3].
   - `Idempotency-Key: <UUIDv4>` on `POST /invoices/{id}/payments` and `POST /billing/run` [PDF 8, 16].
   - `Content-Type: application/json` [PDF 3, 8].
2. **Normalized Query Filters**:
   - `page`, `page_size` for server-side pagination [PDF 8, 11].
   - `status`, `customer_id`, `from`, `to`, `format` [PDF 8].
3. **Validated Input Payloads**:
   - Client-side validated schemas matching backend Pydantic models [PDF 8, 9].

---

## 3. What Frontend Needs from Database Team (`/database`)
1. **Schema Enums**: Strict alignment on string values for:
   - `UserRole`: `admin`, `staff`, `customer` [PDF 5.1].
   - `ProductType`: `service`, `software`, `addon`, `physical` [PDF 5.3].
   - `BillingPeriod`: `daily`, `weekly`, `monthly`, `yearly` [PDF 5.4].
   - `SubscriptionStatus`: `draft`, `quotation`, `confirmed`, `active`, `paused`, `closed`, `cancelled` [PDF 5.6, 6.1].
   - `InvoiceStatus`: `draft`, `confirmed`, `paid`, `cancelled` [PDF 5.9, 6.2].
   - `PaymentMethod`: `card`, `upi`, `bank_transfer`, `cash`, `cheque`, `other` [PDF 5.9].
   - `TaxType`: `percent`, `fixed` [PDF 5.7].
   - `TaxAppliesTo`: `all`, `product`, `category` [PDF 5.7].
   - `DiscountType`: `percent`, `fixed` [PDF 5.8].
   - `DiscountScope`: `product`, `subscription` [PDF 5.8].
2. **Performance Constraints**: Database query response times under 200 ms so that end-to-end page loads remain strictly under 2.0 seconds [PDF 1, 11].
3. **Test Data**: Seed data containing at least 1 Admin, 2 Staff, and 5 Customers with varied subscription lifecycles to validate all UI states [PDF 15].
