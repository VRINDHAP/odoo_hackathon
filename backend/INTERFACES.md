# Backend Interfaces — Subscription Management System (Brightloop)

This document establishes all external and internal API contracts. 
Section 1 defines the complete `openapi.yaml` specification so the frontend team can immediately run mocks.
Section 2 defines internal contracts between Nandana's and Vrindha's modules.
Section 3 defines contracts with the Database team.

---

## 1. OpenAPI 3.0 Specification (`openapi.yaml`) [PDF 8, 14]

```yaml
openapi: 3.0.3
info:
  title: Brightloop Subscription Management System API
  version: 1.0.0
  description: REST API for catalog, subscriptions, automated billing, payments, and reporting.
servers:
  - url: /api/v1
    description: Production & Local Gateway Base URL

components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  schemas:
    ErrorResponse:
      type: object
      required: [code, message, fields]
      properties:
        code:
          type: string
          example: VALIDATION_ERROR
        message:
          type: string
          example: Invalid input parameters
        fields:
          type: array
          items:
            type: object
            properties:
              field:
                type: string
              message:
                type: string

    UserRole:
      type: string
      enum: [admin, staff, customer]

    ProductType:
      type: string
      enum: [service, software, addon, physical]

    BillingPeriod:
      type: string
      enum: [daily, weekly, monthly, yearly]

    SubscriptionStatus:
      type: string
      enum: [draft, quotation, confirmed, active, paused, closed, cancelled]

    InvoiceStatus:
      type: string
      enum: [draft, confirmed, paid, cancelled]

    PaymentMethod:
      type: string
      enum: [card, upi, bank_transfer, cash, cheque, other]

    Money:
      type: string
      example: "1250.00"
      description: Fixed-precision decimal string representing NUMERIC(14,2)

    LoginRequest:
      type: object
      required: [email, password]
      properties:
        email:
          type: string
          format: email
        password:
          type: string

    AuthResponse:
      type: object
      required: [access_token, token_type, expires_in, user]
      properties:
        access_token:
          type: string
        token_type:
          type: string
          example: bearer
        expires_in:
          type: integer
          example: 900
        user:
          type: object
          properties:
            id:
              type: string
            email:
              type: string
            role:
              $ref: '#/components/schemas/UserRole'
            customer_id:
              type: string
              nullable: true

    SignupRequest:
      type: object
      required: [email, password, name]
      properties:
        email:
          type: string
          format: email
        password:
          type: string
          pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$'
        name:
          type: string
        company_name:
          type: string

    StaffCreateRequest:
      type: object
      required: [email, role]
      properties:
        email:
          type: string
          format: email
        role:
          type: string
          enum: [staff]

    SubscriptionLineInput:
      type: object
      required: [product_id, quantity]
      properties:
        product_id:
          type: string
        variant_id:
          type: string
          nullable: true
        quantity:
          type: integer
          minimum: 1
        unit_price:
          $ref: '#/components/schemas/Money'

    SubscriptionCreateRequest:
      type: object
      required: [customer_id, plan_id, lines]
      properties:
        customer_id:
          type: string
        plan_id:
          type: string
        lines:
          type: array
          items:
            $ref: '#/components/schemas/SubscriptionLineInput'

    PaymentCreateRequest:
      type: object
      required: [method, amount, payment_date]
      properties:
        method:
          $ref: '#/components/schemas/PaymentMethod'
        amount:
          $ref: '#/components/schemas/Money'
        payment_date:
          type: string
          format: date-time
        reference:
          type: string
        note:
          type: string

    BillingRunSummaryResponse:
      type: object
      properties:
        run_date:
          type: string
          format: date
        created_count:
          type: integer
        skipped_count:
          type: integer
        failed_count:
          type: integer
        error_summary:
          type: string
          nullable: true

paths:
  # ================= AUTH & USERS =================
  /auth/signup:
    post:
      summary: Register customer account [PDF 8]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SignupRequest'
      responses:
        '201':
          description: Account created successfully
        '409':
          description: Email already registered
        '422':
          $ref: '#/components/responses/ValidationError'

  /auth/login:
    post:
      summary: Authenticate user [PDF 8]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/LoginRequest'
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AuthResponse'
        '401':
          description: Invalid email or password
        '423':
          description: Account locked due to repeated failures

  /auth/refresh:
    post:
      summary: Refresh access token [PDF 8, 9]
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AuthResponse'
        '401':
          description: Invalid or expired refresh token

  /auth/logout:
    post:
      summary: Revoke session [PDF 8]
      security:
        - BearerAuth: []
      responses:
        '204':
          description: Logged out successfully

  /auth/forgot-password:
    post:
      summary: Request password reset link [PDF 8, 9]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email]
              properties:
                email:
                  type: string
      responses:
        '200':
          description: Constant response returned regardless of email existence

  /auth/reset-password:
    post:
      summary: Set new password with token [PDF 8, 9]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [token, new_password]
              properties:
                token:
                  type: string
                new_password:
                  type: string
      responses:
        '200':
          description: Password updated; all sessions revoked

  /users/staff:
    post:
      summary: Provision staff account (Admin only) [PDF 2, 8]
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/StaffCreateRequest'
      responses:
        '201':
          description: Staff account created
        '403':
          description: Admin privilege required

  # ================= CUSTOMERS =================
  /customers:
    get:
      summary: List paginated customers [PDF 8]
      security:
        - BearerAuth: []
      parameters:
        - in: query
          name: page
          schema:
            type: integer
        - in: query
          name: page_size
          schema:
            type: integer
      responses:
        '200':
          description: Paginated customer list
    post:
      summary: Create customer profile [PDF 8]
      security:
        - BearerAuth: []
      responses:
        '201':
          description: Customer created

  /customers/{id}:
    get:
      summary: Get customer detail [PDF 8]
      security:
        - BearerAuth: []
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Customer details
    patch:
      summary: Update customer [PDF 8]
      security:
        - BearerAuth: []
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Customer updated

  # ================= CATALOG & PLANS =================
  /products:
    get:
      summary: List products [PDF 8]
      responses:
        '200':
          description: Products list
    post:
      summary: Create product (Admin only) [PDF 2, 8]
      security:
        - BearerAuth: []
      responses:
        '201':
          description: Product created

  /products/{id}:
    get:
      summary: Get product [PDF 8]
    patch:
      summary: Update product [PDF 8]
      security:
        - BearerAuth: []
    delete:
      summary: Delete product [PDF 8]
      security:
        - BearerAuth: []

  /products/{id}/variants:
    post:
      summary: Add product variant (Admin only) [PDF 5.3, 8]
      security:
        - BearerAuth: []
      responses:
        '201':
          description: Variant created

  /plans:
    get:
      summary: List plans [PDF 8]
    post:
      summary: Create plan (Admin only) [PDF 5.4, 8]
      security:
        - BearerAuth: []

  /plans/{id}:
    patch:
      summary: Update plan and behavior flags (Admin only) [PDF 5.4, 8]
      security:
        - BearerAuth: []

  # ================= QUOTATION TEMPLATES =================
  /quotation-templates:
    get:
      summary: List quotation templates [PDF 8]
      security:
        - BearerAuth: []
    post:
      summary: Create quotation template [PDF 5.5, 8]
      security:
        - BearerAuth: []

  /quotation-templates/{id}/create-quotation:
    post:
      summary: One-click generate quotation draft from template [PDF 5.5, 8]
      security:
        - BearerAuth: []
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
      responses:
        '201':
          description: Draft subscription created

  # ================= SUBSCRIPTIONS =================
  /subscriptions:
    get:
      summary: List subscriptions with filters [PDF 8]
      security:
        - BearerAuth: []
      parameters:
        - in: query
          name: status
          schema:
            $ref: '#/components/schemas/SubscriptionStatus'
        - in: query
          name: customer_id
          schema:
            type: string
      responses:
        '200':
          description: Paginated subscription list
    post:
      summary: Create draft subscription [PDF 8]
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SubscriptionCreateRequest'
      responses:
        '201':
          description: Subscription created

  /subscriptions/{id}:
    get:
      summary: Get subscription detail [PDF 8]
      security:
        - BearerAuth: []
    patch:
      summary: Update subscription lines (Draft mode only) [PDF 8]
      security:
        - BearerAuth: []

  /subscriptions/{id}/transition:
    post:
      summary: Dispatch state machine transition [PDF 6.1, 8]
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [target]
              properties:
                target:
                  $ref: '#/components/schemas/SubscriptionStatus'
      responses:
        '200':
          description: State transition succeeded
        '409':
          description: Illegal transition rejected by state machine matrix

  /subscriptions/{id}/pause:
    post:
      summary: Pause active subscription [PDF 6.1, 8]
      security:
        - BearerAuth: []

  /subscriptions/{id}/resume:
    post:
      summary: Resume paused subscription [PDF 6.1, 8]
      security:
        - BearerAuth: []

  /subscriptions/{id}/close:
    post:
      summary: Close subscription with reason [PDF 5.6, 6.1, 8]
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [close_reason]
              properties:
                close_reason:
                  type: string

  /subscriptions/{id}/renew:
    post:
      summary: Renew closed subscription [PDF 6.1, 8]
      security:
        - BearerAuth: []

  # ================= TAXES & DISCOUNTS =================
  /taxes:
    get:
      summary: List taxes [PDF 8]
    post:
      summary: Create tax rule (Admin only) [PDF 5.7, 8]
      security:
        - BearerAuth: []
    patch:
      summary: Update tax rule (Admin only) [PDF 5.7, 8]
      security:
        - BearerAuth: []

  /discounts:
    get:
      summary: List discounts [PDF 8]
      security:
        - BearerAuth: []
    post:
      summary: Create discount rule (Admin write) [PDF 5.8, 8]
      security:
        - BearerAuth: []
    patch:
      summary: Update discount rule (Admin write) [PDF 5.8, 8]
      security:
        - BearerAuth: []

  /discounts/{id}/usage:
    get:
      summary: Get discount redemption stats and limit [PDF 5.8, 8]
      security:
        - BearerAuth: []

  # ================= INVOICES & BILLING =================
  /invoices:
    get:
      summary: List invoices [PDF 8]
      security:
        - BearerAuth: []
      parameters:
        - in: query
          name: status
          schema:
            $ref: '#/components/schemas/InvoiceStatus'
        - in: query
          name: customer_id
          schema:
            type: string

  /invoices/{id}:
    get:
      summary: Get invoice document [PDF 8]
      security:
        - BearerAuth: []

  /invoices/{id}/confirm:
    post:
      summary: Confirm invoice [PDF 6.2, 8]
      security:
        - BearerAuth: []

  /invoices/{id}/cancel:
    post:
      summary: Cancel invoice and release discount redemptions [PDF 6.2, 7.3, 8]
      security:
        - BearerAuth: []
      responses:
        '200':
          description: Cancelled
        '409':
          description: Paid invoices cannot be cancelled

  /invoices/{id}/send:
    post:
      summary: Dispatch invoice email to customer [PDF 6.2, 8]
      security:
        - BearerAuth: []

  /invoices/{id}/pdf:
    get:
      summary: Download invoice PDF [PDF 8, 11]
      security:
        - BearerAuth: []
      responses:
        '200':
          description: PDF binary stream
          content:
            application/pdf:
              schema:
                type: string
                format: binary

  /billing/run:
    post:
      summary: Admin manual trigger for daily billing engine [PDF 7.2, 8]
      security:
        - BearerAuth: []
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BillingRunSummaryResponse'

  # ================= PAYMENTS =================
  /payments:
    get:
      summary: List recorded payments [PDF 8, 10]
      security:
        - BearerAuth: []
      parameters:
        - in: query
          name: format
          schema:
            type: string
            enum: [json, csv]

  /invoices/{id}/payments:
    post:
      summary: Record payment against invoice [PDF 7.4, 8]
      security:
        - BearerAuth: []
      parameters:
        - in: header
          name: Idempotency-Key
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/PaymentCreateRequest'
      responses:
        '201':
          description: Payment recorded; invoice balance recomputed
        '422':
          description: Overpayment rejected (amount > balance)

  # ================= REPORTS =================
  /reports/summary:
    get:
      summary: Executive KPI summary [PDF 10]
      security:
        - BearerAuth: []
      responses:
        '200':
          description: Executive KPIs object

  /reports/active-subscriptions:
    get:
      summary: Active subscriptions report [PDF 10]
      security:
        - BearerAuth: []
      parameters:
        - in: query
          name: format
          schema:
            type: string
            enum: [json, csv]

  /reports/revenue:
    get:
      summary: Revenue by month, plan, product [PDF 10]
      security:
        - BearerAuth: []
      parameters:
        - in: query
          name: format
          schema:
            type: string
            enum: [json, csv]

  /reports/outstanding:
    get:
      summary: Outstanding invoices report [PDF 10]
      security:
        - BearerAuth: []

  /reports/overdue:
    get:
      summary: Overdue invoices with aging buckets [PDF 7.5, 10]
      security:
        - BearerAuth: []

  /reports/payments:
    get:
      summary: Payments register report [PDF 10]
      security:
        - BearerAuth: []

  # ================= CUSTOMER PORTAL =================
  /me/subscriptions:
    get:
      summary: Get authenticated customer's subscriptions [PDF 8, 9]
      security:
        - BearerAuth: []

  /me/invoices:
    get:
      summary: Get authenticated customer's invoices [PDF 8, 9]
      security:
        - BearerAuth: []

  /me/payments:
    get:
      summary: Get authenticated customer's payment history [PDF 8, 9]
      security:
        - BearerAuth: []

  /me/invoices/{id}/pay:
    post:
      summary: Initiate online payment gateway checkout [PDF 7.4, 8]
      security:
        - BearerAuth: []

  /me/profile:
    patch:
      summary: Update authenticated customer's billing address and profile [PDF 8, 9]
      security:
        - BearerAuth: []

responses:
  ValidationError:
    description: Input validation error
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/ErrorResponse'
```

---

## 2. Internal Domain Boundaries (Nandana <-> Vrindha)

To guarantee complete independence and prevent merge conflicts, Nandana and Vrindha communicate exclusively via typed domain interfaces located in `app/core/contracts.py`:

### 2.1 Services Exposed by Nandana's Modules
- `TaxCalculationService.calculate(tax_id: UUID, taxable_amount: Decimal) -> TaxBreakdown`
  - Used by Vrindha's `invoices` module to compute inclusive or exclusive line taxes [PDF 7.1].
- `DiscountService.evaluate_and_apply(subtotal: Decimal, lines: List[Line], customer_id: UUID, invoice_date: date) -> Optional[DiscountApplication]`
  - Used by Vrindha's `billing_run` to determine eligible discounts and calculate deduction amounts [PDF 7.3].
- `DiscountService.increment_usage(discount_id: UUID) -> bool`
  - Atomic usage count increment called inside billing transaction [PDF 7.3].
- `DiscountService.release_usage(discount_id: UUID) -> None`
  - Decrements usage count when Vrindha's module cancels an unpaid invoice [PDF 7.3].
- `AuditService.record(actor_id: UUID, entity: str, entity_id: str, action: str, before: dict, after: dict, ip: str)`
  - Universal audit logging called by Vrindha's state transitions and payment insertions [PDF 5.10, 9].

### 2.2 Services Exposed by Vrindha's Modules
- `SubscriptionService.get_due_subscriptions(run_date: date, batch_size: int)`
  - Query fetching active subscriptions ready for billing [PDF 7.2].
- `InvoiceService.generate_invoice_for_subscription(subscription_id: UUID, period_start: date, period_end: date) -> Invoice`
  - Core invoicing logic [PDF 7.2].
- `PaymentService.record_payment(invoice_id: UUID, amount: Decimal, method: str, ref: str, user_id: UUID) -> Payment`
  - Processes payments and automatically adjusts invoice balances [PDF 7.4].

---

## 3. What Backend Needs from Database (`/database`)

1. **Schema DDL & Migrations**: PostgreSQL database schema as specified in `database/SPEC.md` [PDF 5]. Backend never runs or creates raw DDL.
2. **Strict Constraints**:
   - `UNIQUE(subscription_id, period_start, period_end)` [PDF 5.9].
   - `UNIQUE(discount_id, invoice_id)` [PDF 5.8].
   - `UNIQUE(product_id, attribute, value)` [PDF 5.3].
   - `UNIQUE(email)` on `users` [PDF 5.1].
3. **Indexes**:
   - `subscriptions(status, next_billing_date)` for fast billing query execution [PDF 5.11].
   - `invoices(status, due_date) WHERE status='confirmed' AND balance>0` for dunning query [PDF 5.11].
4. **Data Seed**:
   - Initial superadmin credentials for bootstrapping: `admin@brightloop.io` / `Password123!` [PDF 15].
   - Populated `payment_terms` table (`Immediate`, `Net 15`, `Net 30`) [PDF 5.6].
