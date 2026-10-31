/* ==========================================================================
   Strict Domain & OpenAPI 3.0 Types (INTERFACES.md & SPEC.md §5)
   ========================================================================== */

export type UserRole = 'admin' | 'staff' | 'customer';
export type ProductType = 'service' | 'software' | 'addon' | 'physical';
export type BillingPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type SubscriptionStatus =
  | 'draft'
  | 'quotation'
  | 'confirmed'
  | 'active'
  | 'paused'
  | 'closed'
  | 'cancelled';
export type InvoiceStatus = 'draft' | 'confirmed' | 'paid' | 'cancelled';
export type PaymentMethod = 'card' | 'upi' | 'bank_transfer' | 'cash' | 'cheque' | 'other';
export type TaxType = 'percent' | 'fixed';
export type TaxAppliesTo = 'all' | 'product' | 'category';
export type DiscountType = 'percent' | 'fixed';
export type DiscountScope = 'product' | 'subscription';
export type PaymentTerms = 'Immediate' | 'Net 15' | 'Net 30';
export type CustomerStatus = 'active' | 'inactive';

export interface FieldValidationError {
  field: string;
  message: string;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  fields: FieldValidationError[];
}

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  role: UserRole;
  customer_id: string | null;
  failed_attempts?: number;
  locked_until?: string | null;
  last_login_at?: string | null;
  created_at?: string;
  is_active?: boolean;
}

export interface AuthResponse {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  user: AuthUser;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface BillingAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  company_name: string;
  tax_id: string;
  billing_address: BillingAddress;
  status: CustomerStatus;
  portal_user_linked: boolean;
  created_at: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  attribute: string;
  value: string;
  extra_price: string; // NUMERIC(14,2)
}

export interface Product {
  id: string;
  name: string;
  type: ProductType;
  sales_price: string; // NUMERIC(14,2)
  cost_price: string; // NUMERIC(14,2)
  tax_id: string | null;
  notes: string;
  is_active: boolean;
  variants: ProductVariant[];
}

export interface Plan {
  id: string;
  name: string;
  price: string; // NUMERIC(14,2)
  billing_period: BillingPeriod;
  min_quantity: number;
  valid_from: string;
  valid_to: string | null;
  auto_close: boolean;
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
  is_active: boolean;
}

export interface TaxRule {
  id: string;
  name: string;
  type: TaxType;
  rate: string; // NUMERIC(14,2)
  inclusive: boolean;
  applies_to: TaxAppliesTo;
  is_active: boolean;
}

export interface DiscountRule {
  id: string;
  name: string;
  code?: string;
  type: DiscountType;
  value: string; // NUMERIC(14,2)
  min_purchase_amount: string;
  min_quantity: number;
  start_date: string;
  end_date: string | null;
  usage_limit: number | null;
  usage_count: number;
  scope: DiscountScope;
  product_ids: string[];
  is_active: boolean;
}

export interface QuotationTemplateLine {
  id: string;
  product_id: string;
  product_name: string;
  variant_id: string | null;
  variant_label?: string | null;
  quantity: number;
  unit_price: string;
}

export interface QuotationTemplate {
  id: string;
  name: string;
  validity_days: number;
  plan_id: string;
  plan_name: string;
  notes: string;
  lines: QuotationTemplateLine[];
}

export interface SubscriptionLine {
  id: string;
  product_id: string;
  product_name: string;
  variant_id: string | null;
  variant_label?: string | null;
  quantity: number;
  unit_price: string;
  tax_rate: string;
  tax_inclusive: boolean;
  line_subtotal: string;
  line_tax: string;
  line_total: string;
}

export interface SubscriptionActivity {
  id: string;
  timestamp: string;
  actor_email: string;
  action: string;
  note: string;
}

export interface Subscription {
  id: string;
  number: string;
  customer_id: string;
  customer_name: string;
  plan_id: string;
  plan_name: string;
  billing_period: BillingPeriod;
  status: SubscriptionStatus;
  payment_terms: PaymentTerms;
  anchor_day: number;
  start_date: string | null;
  expiry_date: string | null;
  next_billing_date: string | null;
  last_billed_through: string | null;
  quote_valid_until: string | null;
  paused_at: string | null;
  closed_at: string | null;
  close_reason?: string | null;
  coupon_code?: string | null;
  discount_name?: string | null;
  currency: string;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  total: string;
  lines: SubscriptionLine[];
  activities: SubscriptionActivity[];
}

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unit_price: string;
  tax_rate: string;
  tax_inclusive: boolean;
  line_subtotal: string;
  line_tax: string;
  line_total: string;
}

export interface Invoice {
  id: string;
  number: string;
  subscription_id: string | null;
  subscription_number: string | null;
  customer_id: string;
  customer_name: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  sent_at: string | null;
  currency: string;
  discount_name?: string | null;
  discount_released?: boolean;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  total: string;
  amount_paid: string;
  balance: string;
  pdf_ready: boolean;
  lines: InvoiceLine[];
}

export interface PaymentRecord {
  id: string;
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  method: PaymentMethod;
  amount: string; // Negative for reversals
  currency: string;
  payment_date: string;
  reference: string;
  note: string;
  is_reversal: boolean;
  reversal_reason?: string | null;
}

export interface BillingRunSummary {
  id: string;
  run_date: string;
  created_count: number;
  skipped_count: number;
  failed_count: number;
  error_summary: string | null;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor_id: string;
  actor_email: string;
  actor_role: UserRole;
  entity: string;
  entity_id: string;
  action: string;
  ip_address: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface SystemSettings {
  company_name: string;
  company_email: string;
  company_tax_id: string;
  company_address: string;
  timezone: string;
  currency: string;
  invoice_prefix: string;
  subscription_prefix: string;
  reminder_days_before_due: number;
  overdue_reminder_cadence_days: number;
}

export interface NotificationItem {
  id: string;
  created_at: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning';
  read: boolean;
}

export interface DashboardSummary {
  currency: string;
  active_subscriptions: number;
  paused_subscriptions: number;
  mrr: string;
  arr: string;
  revenue_collected: string;
  total_invoiced: string;
  outstanding_amount: string;
  overdue_invoice_count: number;
  overdue_amount: string;
  new_subscriptions_count: number;
  closed_subscriptions_count: number;
  payments_by_method: Array<{ method: PaymentMethod; amount: string; count: number }>;
  revenue_trend: Array<{ month: string; invoiced: number; collected: number }>;
  aging_buckets: Array<{ bucket: '0-30 days' | '31-60 days' | '61-90 days' | '90+ days'; count: number; amount: string }>;
}

