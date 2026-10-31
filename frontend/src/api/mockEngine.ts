/* ==========================================================================
   Stateful OpenAPI 3.0 Mock Engine (INTERFACES.md §1 & §3.3)
   - Automatically engages when live /api/v1 backend route is unreachable or 404
   - Seeds 1 Admin, 2 Staff, 6 Customers, Catalog, Plans, Taxes, Discounts,
     Quotation Templates, Subscriptions (all 7 states), Invoices, Payments,
     Audit Logs (with JSON before/after diffs), and System Settings
   ========================================================================== */

import type {
  AgingBucketLabel,
  AgingBucketSummary,
  ApiErrorPayload,
  AuditLogEntry,
  AuthResponse,
  AuthUser,
  BillingRunSummary,
  Customer,
  DashboardSummary,
  DiscountRule,
  Invoice,
  NotificationItem,
  OutstandingReportResponse,
  OverdueReportResponse,
  PaginatedResponse,
  PaymentMethod,
  PaymentRecord,
  PaymentsReportResponse,
  Plan,
  Product,
  QuotationTemplate,
  RevenueReportRow,
  Subscription,
  SubscriptionLine,
  SubscriptionStatus,
  SystemSettings,
  TaxRule,
} from '../types/domain';
import { tokenStore } from './tokenStore';
import { daysOverdue, isInvoiceOverdue, todayIsoDate } from '../utils/dates';
import { normalizeToMonthlyMrr, parseMoney, roundHalfUp, toFixedMoney } from '../utils/money';
import { evaluatePasswordStrength, isValidEmail, normalizeEmail } from '../utils/validation';

export interface MockHttpResponse {
  status: number;
  data?: unknown;
  blob?: Blob;
  headers?: Record<string, string>;
}

interface MockUserRecord extends AuthUser {
  password: string;
}

class MockDatabase {
  users: MockUserRecord[] = [
    {
      id: 'usr-admin-01',
      email: 'admin@brightloop.io',
      name: 'Surya T S',
      role: 'admin',
      customer_id: null,
      password: 'Admin@2026!',
      failed_attempts: 0,
      locked_until: null,
      last_login_at: '2026-10-31T06:45:00Z',
      created_at: '2026-01-10T09:00:00Z',
      is_active: true,
    },
    {
      id: 'usr-staff-01',
      email: 'nandana@brightloop.io',
      name: 'Nandana R',
      role: 'staff',
      customer_id: null,
      password: 'Staff@2026!',
      failed_attempts: 0,
      locked_until: null,
      last_login_at: '2026-10-30T15:20:00Z',
      created_at: '2026-02-01T10:00:00Z',
      is_active: true,
    },
    {
      id: 'usr-staff-02',
      email: 'vrindha@brightloop.io',
      name: 'Vrindha K',
      role: 'staff',
      customer_id: null,
      password: 'Staff@2026!',
      failed_attempts: 0,
      locked_until: null,
      last_login_at: '2026-10-31T05:10:00Z',
      created_at: '2026-02-14T11:30:00Z',
      is_active: true,
    },
    {
      id: 'usr-cust-01',
      email: 'arjun@vervecloud.in',
      name: 'Arjun Menon',
      role: 'customer',
      customer_id: 'cust-01',
      password: 'Customer@2026!',
      failed_attempts: 0,
      locked_until: null,
      last_login_at: '2026-10-29T13:15:00Z',
      created_at: '2026-03-05T08:00:00Z',
      is_active: true,
    },
  ];

  settings: SystemSettings = {
    company_name: 'Brightloop Revenue Systems Pvt. Ltd.',
    company_email: 'billing@brightloop.io',
    company_tax_id: '29AABCB4821M1Z4',
    company_address: '42 Residency Road, Indiranagar, Bengaluru, KA 560038',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    invoice_prefix: 'INV-2026-',
    subscription_prefix: 'SUB-2026-',
    reminder_days_before_due: 3,
    overdue_reminder_cadence_days: 7,
  };

  taxes: TaxRule[] = [
    { id: 'tax-gst-18', name: 'GST 18%', type: 'percent', rate: '18.00', inclusive: false, applies_to: 'all', is_active: true },
    { id: 'tax-gst-12-inc', name: 'GST 12% (Inclusive)', type: 'percent', rate: '12.00', inclusive: true, applies_to: 'category', is_active: true },
    { id: 'tax-cess-flat', name: 'Regulatory Levy', type: 'fixed', rate: '250.00', inclusive: false, applies_to: 'product', is_active: true },
  ];

  products: Product[] = [
    {
      id: 'prod-01',
      name: 'Brightloop Core ERP Suite',
      type: 'software',
      sales_price: '4500.00',
      cost_price: '1200.00',
      tax_id: 'tax-gst-18',
      notes: 'Per-seat cloud operational workspace license.',
      is_active: true,
      variants: [
        { id: 'var-01', product_id: 'prod-01', attribute: 'Edition', value: 'Enterprise SSO', extra_price: '1500.00' },
        { id: 'var-02', product_id: 'prod-01', attribute: 'Region', value: 'Dedicated India DC', extra_price: '800.00' },
      ],
    },
    {
      id: 'prod-02',
      name: 'Automated Treasury & Recon Add-on',
      type: 'addon',
      sales_price: '2800.00',
      cost_price: '650.00',
      tax_id: 'tax-gst-18',
      notes: 'Real-time bank feed reconciliation and payout ledger.',
      is_active: true,
      variants: [
        { id: 'var-03', product_id: 'prod-02', attribute: 'Connector', value: 'Multi-Bank SWIFT', extra_price: '1200.00' },
      ],
    },
    {
      id: 'prod-03',
      name: 'Dedicated RevOps Advisory',
      type: 'service',
      sales_price: '12000.00',
      cost_price: '6800.00',
      tax_id: 'tax-gst-18',
      notes: 'Monthly controller onboarding and tax compliance review.',
      is_active: true,
      variants: [],
    },
    {
      id: 'prod-04',
      name: 'Smart POS Billing Terminal',
      type: 'physical',
      sales_price: '6500.00',
      cost_price: '4100.00',
      tax_id: 'tax-gst-18',
      notes: 'Hardware reader leased with recurring warranty.',
      is_active: true,
      variants: [],
    },
  ];

  plans: Plan[] = [
    {
      id: 'plan-monthly-growth',
      name: 'Growth Monthly',
      price: '4500.00',
      billing_period: 'monthly',
      min_quantity: 5,
      valid_from: '2026-01-01',
      valid_to: null,
      auto_close: false,
      closable: true,
      pausable: true,
      renewable: true,
      is_active: true,
    },
    {
      id: 'plan-annual-scale',
      name: 'Enterprise Annual Commit',
      price: '48000.00',
      billing_period: 'yearly',
      min_quantity: 10,
      valid_from: '2026-01-01',
      valid_to: '2027-12-31',
      auto_close: false,
      closable: true,
      pausable: false,
      renewable: true,
      is_active: true,
    },
    {
      id: 'plan-weekly-sprint',
      name: 'Pilot Weekly Sandbox',
      price: '1400.00',
      billing_period: 'weekly',
      min_quantity: 1,
      valid_from: '2026-01-01',
      valid_to: null,
      auto_close: true,
      closable: true,
      pausable: false,
      renewable: false,
      is_active: true,
    },
    {
      id: 'plan-daily-usage',
      name: 'Metered Daily Burst',
      price: '350.00',
      billing_period: 'daily',
      min_quantity: 1,
      valid_from: '2026-01-01',
      valid_to: null,
      auto_close: false,
      closable: true,
      pausable: true,
      renewable: true,
      is_active: true,
    },
  ];

  discounts: DiscountRule[] = [
    {
      id: 'disc-01',
      name: 'Annual Scale 15% Off',
      code: 'SCALE15',
      type: 'percent',
      value: '15.00',
      min_purchase_amount: '25000.00',
      min_quantity: 5,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      usage_limit: 100,
      usage_count: 34,
      scope: 'subscription',
      product_ids: [],
      is_active: true,
    },
    {
      id: 'disc-02',
      name: 'Founder Launch Credit',
      code: 'LAUNCH5000',
      type: 'fixed',
      value: '5000.00',
      min_purchase_amount: '15000.00',
      min_quantity: 1,
      start_date: '2026-06-01',
      end_date: '2026-11-30',
      usage_limit: 50,
      usage_count: 19,
      scope: 'subscription',
      product_ids: [],
      is_active: true,
    },
  ];

  customers: Customer[] = [
    {
      id: 'cust-01',
      name: 'Arjun Menon',
      email: 'arjun@vervecloud.in',
      phone: '+91 98450 11223',
      company_name: 'VerveCloud Technologies Pvt Ltd',
      tax_id: '29AAACV1290F1Z2',
      billing_address: {
        line1: '88 Lavelle Road, Suite 402',
        city: 'Bengaluru',
        state: 'Karnataka',
        postal_code: '560001',
        country: 'India',
      },
      status: 'active',
      portal_user_linked: true,
      created_at: '2026-03-05T08:00:00Z',
    },
    {
      id: 'cust-02',
      name: 'Meera Krishnan',
      email: 'finance@kinetixlabs.io',
      phone: '+91 98201 44510',
      company_name: 'Kinetix Robotics Labs',
      tax_id: '27AABCK8832H1Z8',
      billing_address: {
        line1: 'Bandra Kurla Complex, Tower C',
        city: 'Mumbai',
        state: 'Maharashtra',
        postal_code: '400051',
        country: 'India',
      },
      status: 'active',
      portal_user_linked: false,
      created_at: '2026-03-18T10:15:00Z',
    },
    {
      id: 'cust-03',
      name: 'Rohan Deshmukh',
      email: 'ap@solarisretail.com',
      phone: '+91 97654 90812',
      company_name: 'Solaris Omni Retail',
      tax_id: '27AADCS4410P1Z1',
      billing_address: {
        line1: '14 Baner Pashan Link Rd',
        city: 'Pune',
        state: 'Maharashtra',
        postal_code: '411045',
        country: 'India',
      },
      status: 'active',
      portal_user_linked: false,
      created_at: '2026-04-02T12:00:00Z',
    },
    {
      id: 'cust-04',
      name: 'Ananya Sharma',
      email: 'ops@northstarhealth.in',
      phone: '+91 98112 77320',
      company_name: 'Northstar Diagnostics',
      tax_id: '07AAACN9921D1Z5',
      billing_address: {
        line1: 'Cyberhub Phase 2, DLF',
        city: 'Gurugram',
        state: 'Haryana',
        postal_code: '122002',
        country: 'India',
      },
      status: 'active',
      portal_user_linked: false,
      created_at: '2026-05-11T09:30:00Z',
    },
    {
      id: 'cust-05',
      name: 'Vikramaditya Rao',
      email: 'accounts@deccanfreight.co',
      phone: '+91 90001 33891',
      company_name: 'Deccan Freight Logistics',
      tax_id: '36AABCD5501E1Z9',
      billing_address: {
        line1: 'HITEC City, Madhapur',
        city: 'Hyderabad',
        state: 'Telangana',
        postal_code: '500081',
        country: 'India',
      },
      status: 'active',
      portal_user_linked: false,
      created_at: '2026-06-20T14:40:00Z',
    },
    {
      id: 'cust-06',
      name: 'Kabir Malhotra',
      email: 'legacy@oldharbor.in',
      phone: '+91 98331 00219',
      company_name: 'OldHarbor Trading Co',
      tax_id: '19AAACO3321L1Z0',
      billing_address: {
        line1: 'Park Street Annex',
        city: 'Kolkata',
        state: 'West Bengal',
        postal_code: '700016',
        country: 'India',
      },
      status: 'inactive',
      portal_user_linked: false,
      created_at: '2026-01-25T11:00:00Z',
    },
  ];

  templates: QuotationTemplate[] = [
    {
      id: 'tpl-01',
      name: 'Standard SaaS Growth Bundle (10 Seats)',
      validity_days: 15,
      plan_id: 'plan-monthly-growth',
      plan_name: 'Growth Monthly',
      notes: 'Includes Core ERP + Automated Treasury Recon with Net 15 terms.',
      lines: [
        {
          id: 'tpl-line-01',
          product_id: 'prod-01',
          product_name: 'Brightloop Core ERP Suite',
          variant_id: 'var-01',
          variant_label: 'Edition: Enterprise SSO',
          quantity: 10,
          unit_price: '6000.00',
        },
        {
          id: 'tpl-line-02',
          product_id: 'prod-02',
          product_name: 'Automated Treasury & Recon Add-on',
          variant_id: null,
          variant_label: null,
          quantity: 1,
          unit_price: '2800.00',
        },
      ],
    },
    {
      id: 'tpl-02',
      name: 'Enterprise Annual Controller Pack',
      validity_days: 30,
      plan_id: 'plan-annual-scale',
      plan_name: 'Enterprise Annual Commit',
      notes: 'Annual commitment eligible for 15% Scale discount.',
      lines: [
        {
          id: 'tpl-line-03',
          product_id: 'prod-01',
          product_name: 'Brightloop Core ERP Suite',
          variant_id: null,
          variant_label: null,
          quantity: 15,
          unit_price: '4500.00',
        },
        {
          id: 'tpl-line-04',
          product_id: 'prod-03',
          product_name: 'Dedicated RevOps Advisory',
          variant_id: null,
          variant_label: null,
          quantity: 1,
          unit_price: '12000.00',
        },
      ],
    },
  ];

  subscriptions: Subscription[] = [
    {
      id: 'sub-01',
      number: 'SUB-2026-000101',
      customer_id: 'cust-01',
      customer_name: 'VerveCloud Technologies Pvt Ltd',
      plan_id: 'plan-monthly-growth',
      plan_name: 'Growth Monthly',
      billing_period: 'monthly',
      status: 'active',
      payment_terms: 'Net 15',
      anchor_day: 5,
      start_date: '2026-03-05',
      expiry_date: '2027-03-05',
      next_billing_date: '2026-11-05',
      last_billed_through: '2026-10-05',
      quote_valid_until: '2026-03-20',
      paused_at: null,
      closed_at: null,
      discount_name: 'Annual Scale 15% Off',
      currency: 'INR',
      subtotal: '62800.00',
      discount_total: '9420.00',
      tax_total: '9608.40',
      total: '62988.40',
      lines: [
        {
          id: 'sline-01',
          product_id: 'prod-01',
          product_name: 'Brightloop Core ERP Suite',
          variant_id: 'var-01',
          variant_label: 'Edition: Enterprise SSO',
          quantity: 10,
          unit_price: '6000.00',
          tax_rate: '18.00',
          tax_inclusive: false,
          line_subtotal: '60000.00',
          line_tax: '9180.00',
          line_total: '69180.00',
        },
        {
          id: 'sline-02',
          product_id: 'prod-02',
          product_name: 'Automated Treasury & Recon Add-on',
          variant_id: null,
          variant_label: null,
          quantity: 1,
          unit_price: '2800.00',
          tax_rate: '18.00',
          tax_inclusive: false,
          line_subtotal: '2800.00',
          line_tax: '428.40',
          line_total: '3228.40',
        },
      ],
      activities: [
        { id: 'act-01', timestamp: '2026-03-05T09:10:00Z', actor_email: 'nandana@brightloop.io', action: 'Activated', note: 'Subscription activated on schedule.' },
        { id: 'act-02', timestamp: '2026-10-05T00:05:00Z', actor_email: 'system@brightloop.io', action: 'Billed', note: 'Generated invoice INV-2026-000412.' },
      ],
    },
    {
      id: 'sub-02',
      number: 'SUB-2026-000102',
      customer_id: 'cust-02',
      customer_name: 'Kinetix Robotics Labs',
      plan_id: 'plan-annual-scale',
      plan_name: 'Enterprise Annual Commit',
      billing_period: 'yearly',
      status: 'active',
      payment_terms: 'Net 30',
      anchor_day: 18,
      start_date: '2026-03-18',
      expiry_date: '2027-03-18',
      next_billing_date: '2027-03-18',
      last_billed_through: '2026-03-18',
      quote_valid_until: '2026-04-01',
      paused_at: null,
      closed_at: null,
      currency: 'INR',
      subtotal: '480000.00',
      discount_total: '0.00',
      tax_total: '86400.00',
      total: '566400.00',
      lines: [
        {
          id: 'sline-03',
          product_id: 'prod-01',
          product_name: 'Brightloop Core ERP Suite',
          variant_id: null,
          variant_label: null,
          quantity: 10,
          unit_price: '48000.00',
          tax_rate: '18.00',
          tax_inclusive: false,
          line_subtotal: '480000.00',
          line_tax: '86400.00',
          line_total: '566400.00',
        },
      ],
      activities: [
        { id: 'act-03', timestamp: '2026-03-18T11:00:00Z', actor_email: 'admin@brightloop.io', action: 'Activated', note: 'Annual enterprise contract signed.' },
      ],
    },
    {
      id: 'sub-03',
      number: 'SUB-2026-000103',
      customer_id: 'cust-03',
      customer_name: 'Solaris Omni Retail',
      plan_id: 'plan-monthly-growth',
      plan_name: 'Growth Monthly',
      billing_period: 'monthly',
      status: 'paused',
      payment_terms: 'Net 15',
      anchor_day: 10,
      start_date: '2026-05-10',
      expiry_date: '2027-05-10',
      next_billing_date: null,
      last_billed_through: '2026-09-10',
      quote_valid_until: '2026-05-25',
      paused_at: '2026-10-02T14:00:00Z',
      closed_at: null,
      currency: 'INR',
      subtotal: '32500.00',
      discount_total: '0.00',
      tax_total: '5850.00',
      total: '38350.00',
      lines: [
        {
          id: 'sline-04',
          product_id: 'prod-04',
          product_name: 'Smart POS Billing Terminal',
          variant_id: null,
          variant_label: null,
          quantity: 5,
          unit_price: '6500.00',
          tax_rate: '18.00',
          tax_inclusive: false,
          line_subtotal: '32500.00',
          line_tax: '5850.00',
          line_total: '38350.00',
        },
      ],
      activities: [
        { id: 'act-04', timestamp: '2026-10-02T14:00:00Z', actor_email: 'vrindha@brightloop.io', action: 'Paused', note: 'Seasonal warehouse renovation pause.' },
      ],
    },
    {
      id: 'sub-04',
      number: 'SUB-2026-000104',
      customer_id: 'cust-04',
      customer_name: 'Northstar Diagnostics',
      plan_id: 'plan-monthly-growth',
      plan_name: 'Growth Monthly',
      billing_period: 'monthly',
      status: 'quotation',
      payment_terms: 'Net 15',
      anchor_day: 1,
      start_date: null,
      expiry_date: null,
      next_billing_date: null,
      last_billed_through: null,
      quote_valid_until: '2026-11-15',
      paused_at: null,
      closed_at: null,
      currency: 'INR',
      subtotal: '34500.00',
      discount_total: '0.00',
      tax_total: '6210.00',
      total: '40710.00',
      lines: [
        {
          id: 'sline-05',
          product_id: 'prod-01',
          product_name: 'Brightloop Core ERP Suite',
          variant_id: null,
          variant_label: null,
          quantity: 5,
          unit_price: '4500.00',
          tax_rate: '18.00',
          tax_inclusive: false,
          line_subtotal: '22500.00',
          line_tax: '4050.00',
          line_total: '26550.00',
        },
        {
          id: 'sline-06',
          product_id: 'prod-03',
          product_name: 'Dedicated RevOps Advisory',
          variant_id: null,
          variant_label: null,
          quantity: 1,
          unit_price: '12000.00',
          tax_rate: '18.00',
          tax_inclusive: false,
          line_subtotal: '12000.00',
          line_tax: '2160.00',
          line_total: '14160.00',
        },
      ],
      activities: [
        { id: 'act-05', timestamp: '2026-10-28T16:30:00Z', actor_email: 'nandana@brightloop.io', action: 'Quotation Sent', note: 'Sent formal quote valid through Nov 15.' },
      ],
    },
    {
      id: 'sub-05',
      number: 'SUB-2026-000105',
      customer_id: 'cust-05',
      customer_name: 'Deccan Freight Logistics',
      plan_id: 'plan-monthly-growth',
      plan_name: 'Growth Monthly',
      billing_period: 'monthly',
      status: 'draft',
      payment_terms: 'Immediate',
      anchor_day: 31,
      start_date: null,
      expiry_date: null,
      next_billing_date: null,
      last_billed_through: null,
      quote_valid_until: null,
      paused_at: null,
      closed_at: null,
      currency: 'INR',
      subtotal: '26500.00',
      discount_total: '0.00',
      tax_total: '4770.00',
      total: '31270.00',
      lines: [
        {
          id: 'sline-07',
          product_id: 'prod-01',
          product_name: 'Brightloop Core ERP Suite',
          variant_id: 'var-02',
          variant_label: 'Region: Dedicated India DC',
          quantity: 5,
          unit_price: '5300.00',
          tax_rate: '18.00',
          tax_inclusive: false,
          line_subtotal: '26500.00',
          line_tax: '4770.00',
          line_total: '31270.00',
        },
      ],
      activities: [
        { id: 'act-06', timestamp: '2026-10-30T10:15:00Z', actor_email: 'nandana@brightloop.io', action: 'Draft Created', note: 'Prepared initial seat estimate.' },
      ],
    },
    {
      id: 'sub-06',
      number: 'SUB-2026-000106',
      customer_id: 'cust-06',
      customer_name: 'OldHarbor Trading Co',
      plan_id: 'plan-monthly-growth',
      plan_name: 'Growth Monthly',
      billing_period: 'monthly',
      status: 'closed',
      payment_terms: 'Net 15',
      anchor_day: 25,
      start_date: '2026-02-01',
      expiry_date: '2026-08-01',
      next_billing_date: null,
      last_billed_through: '2026-07-01',
      quote_valid_until: '2026-02-10',
      paused_at: null,
      closed_at: '2026-08-02T09:00:00Z',
      close_reason: 'Completed 6-month transition contract.',
      currency: 'INR',
      subtotal: '22500.00',
      discount_total: '0.00',
      tax_total: '4050.00',
      total: '26550.00',
      lines: [
        {
          id: 'sline-08',
          product_id: 'prod-01',
          product_name: 'Brightloop Core ERP Suite',
          variant_id: null,
          variant_label: null,
          quantity: 5,
          unit_price: '4500.00',
          tax_rate: '18.00',
          tax_inclusive: false,
          line_subtotal: '22500.00',
          line_tax: '4050.00',
          line_total: '26550.00',
        },
      ],
      activities: [
        { id: 'act-07', timestamp: '2026-08-02T09:00:00Z', actor_email: 'admin@brightloop.io', action: 'Closed', note: 'Completed 6-month transition contract.' },
      ],
    },
  ];

  invoices: Invoice[] = [
    {
      id: 'inv-01',
      number: 'INV-2026-000409',
      subscription_id: 'sub-01',
      subscription_number: 'SUB-2026-000101',
      customer_id: 'cust-01',
      customer_name: 'VerveCloud Technologies Pvt Ltd',
      status: 'paid',
      issue_date: '2026-09-05',
      due_date: '2026-09-20',
      sent_at: '2026-09-05T09:15:00Z',
      currency: 'INR',
      discount_name: 'Annual Scale 15% Off',
      subtotal: '62800.00',
      discount_total: '9420.00',
      tax_total: '9608.40',
      total: '62988.40',
      amount_paid: '62988.40',
      balance: '0.00',
      pdf_ready: true,
      lines: [
        {
          id: 'iline-01',
          description: 'Brightloop Core ERP Suite (Enterprise SSO) × 10',
          quantity: 10,
          unit_price: '6000.00',
          tax_rate: '18.00',
          tax_inclusive: false,
          line_subtotal: '60000.00',
          line_tax: '9180.00',
          line_total: '69180.00',
        },
        {
          id: 'iline-02',
          description: 'Automated Treasury & Recon Add-on × 1',
          quantity: 1,
          unit_price: '2800.00',
          tax_rate: '18.00',
          tax_inclusive: false,
          line_subtotal: '2800.00',
          line_tax: '428.40',
          line_total: '3228.40',
        },
      ],
    },
    {
      id: 'inv-02',
      number: 'INV-2026-000412',
      subscription_id: 'sub-01',
      subscription_number: 'SUB-2026-000101',
      customer_id: 'cust-01',
      customer_name: 'VerveCloud Technologies Pvt Ltd',
      status: 'confirmed',
      issue_date: '2026-10-05',
      due_date: '2026-10-20',
      sent_at: '2026-10-05T10:00:00Z',
      currency: 'INR',
      discount_name: 'Annual Scale 15% Off',
      subtotal: '62800.00',
      discount_total: '9420.00',
      tax_total: '9608.40',
      total: '62988.40',
      amount_paid: '20000.00',
      balance: '42988.40',
      pdf_ready: true,
      lines: [
        {
          id: 'iline-03',
          description: 'Brightloop Core ERP Suite (Enterprise SSO) × 10',
          quantity: 10,
          unit_price: '6000.00',
          tax_rate: '18.00',
          tax_inclusive: false,
          line_subtotal: '60000.00',
          line_tax: '9180.00',
          line_total: '69180.00',
        },
        {
          id: 'iline-04',
          description: 'Automated Treasury & Recon Add-on × 1',
          quantity: 1,
          unit_price: '2800.00',
          tax_rate: '18.00',
          tax_inclusive: false,
          line_subtotal: '2800.00',
          line_tax: '428.40',
          line_total: '3228.40',
        },
      ],
    },
    {
      id: 'inv-03',
      number: 'INV-2026-000415',
      subscription_id: 'sub-02',
      subscription_number: 'SUB-2026-000102',
      customer_id: 'cust-02',
      customer_name: 'Kinetix Robotics Labs',
      status: 'paid',
      issue_date: '2026-03-18',
      due_date: '2026-04-17',
      sent_at: '2026-03-18T11:05:00Z',
      currency: 'INR',
      subtotal: '480000.00',
      discount_total: '0.00',
      tax_total: '86400.00',
      total: '566400.00',
      amount_paid: '566400.00',
      balance: '0.00',
      pdf_ready: true,
      lines: [
        {
          id: 'iline-05',
          description: 'Brightloop Core ERP Suite (Annual Commit) × 10',
          quantity: 10,
          unit_price: '48000.00',
          tax_rate: '18.00',
          tax_inclusive: false,
          line_subtotal: '480000.00',
          line_tax: '86400.00',
          line_total: '566400.00',
        },
      ],
    },
    {
      id: 'inv-04',
      number: 'INV-2026-000418',
      subscription_id: 'sub-03',
      subscription_number: 'SUB-2026-000103',
      customer_id: 'cust-03',
      customer_name: 'Solaris Omni Retail',
      status: 'confirmed',
      issue_date: '2026-08-10',
      due_date: '2026-08-25',
      sent_at: '2026-08-10T09:00:00Z',
      currency: 'INR',
      subtotal: '32500.00',
      discount_total: '0.00',
      tax_total: '5850.00',
      total: '38350.00',
      amount_paid: '0.00',
      balance: '38350.00',
      pdf_ready: true,
      lines: [
        {
          id: 'iline-06',
          description: 'Smart POS Billing Terminal × 5',
          quantity: 5,
          unit_price: '6500.00',
          tax_rate: '18.00',
          tax_inclusive: false,
          line_subtotal: '32500.00',
          line_tax: '5850.00',
          line_total: '38350.00',
        },
      ],
    },
    {
      id: 'inv-05',
      number: 'INV-2026-000421',
      subscription_id: 'sub-05',
      subscription_number: 'SUB-2026-000105',
      customer_id: 'cust-05',
      customer_name: 'Deccan Freight Logistics',
      status: 'draft',
      issue_date: '2026-10-30',
      due_date: '2026-11-14',
      sent_at: null,
      currency: 'INR',
      subtotal: '26500.00',
      discount_total: '0.00',
      tax_total: '4770.00',
      total: '31270.00',
      amount_paid: '0.00',
      balance: '31270.00',
      pdf_ready: true,
      lines: [
        {
          id: 'iline-07',
          description: 'Brightloop Core ERP Suite (Dedicated India DC) × 5',
          quantity: 5,
          unit_price: '5300.00',
          tax_rate: '18.00',
          tax_inclusive: false,
          line_subtotal: '26500.00',
          line_tax: '4770.00',
          line_total: '31270.00',
        },
      ],
    },
  ];

  payments: PaymentRecord[] = [
    {
      id: 'pay-01',
      invoice_id: 'inv-01',
      invoice_number: 'INV-2026-000409',
      customer_id: 'cust-01',
      customer_name: 'VerveCloud Technologies Pvt Ltd',
      method: 'bank_transfer',
      amount: '62988.40',
      currency: 'INR',
      payment_date: '2026-09-18T11:30:00Z',
      reference: 'NEFT-HDFC-9928172',
      note: 'September cycle settlement.',
      is_reversal: false,
    },
    {
      id: 'pay-02',
      invoice_id: 'inv-02',
      invoice_number: 'INV-2026-000412',
      customer_id: 'cust-01',
      customer_name: 'VerveCloud Technologies Pvt Ltd',
      method: 'upi',
      amount: '20000.00',
      currency: 'INR',
      payment_date: '2026-10-15T14:22:00Z',
      reference: 'UPI-428910029182',
      note: 'Partial tranche 1.',
      is_reversal: false,
    },
    {
      id: 'pay-03',
      invoice_id: 'inv-03',
      invoice_number: 'INV-2026-000415',
      customer_id: 'cust-02',
      customer_name: 'Kinetix Robotics Labs',
      method: 'card',
      amount: '566400.00',
      currency: 'INR',
      payment_date: '2026-03-25T16:05:00Z',
      reference: 'RZP-CORP-77319',
      note: 'Annual upfront payment.',
      is_reversal: false,
    },
    {
      id: 'pay-04',
      invoice_id: 'inv-04',
      invoice_number: 'INV-2026-000418',
      customer_id: 'cust-03',
      customer_name: 'Solaris Omni Retail',
      method: 'cheque',
      amount: '38350.00',
      currency: 'INR',
      payment_date: '2026-08-22T10:00:00Z',
      reference: 'CHQ-009481',
      note: 'Cleared cheque deposit.',
      is_reversal: false,
    },
    {
      id: 'pay-05',
      invoice_id: 'inv-04',
      invoice_number: 'INV-2026-000418',
      customer_id: 'cust-03',
      customer_name: 'Solaris Omni Retail',
      method: 'cheque',
      amount: '-38350.00',
      currency: 'INR',
      payment_date: '2026-08-24T17:15:00Z',
      reference: 'REV-CHQ-009481',
      note: 'Drawer signature mismatch bank return.',
      is_reversal: true,
      reversal_reason: 'Instrument returned unpaid by clearing house',
    },
  ];

  auditLogs: AuditLogEntry[] = [
    {
      id: 'aud-01',
      timestamp: '2026-10-31T06:50:12Z',
      actor_id: 'usr-admin-01',
      actor_email: 'admin@brightloop.io',
      actor_role: 'admin',
      entity: 'Plan',
      entity_id: 'plan-monthly-growth',
      action: 'plan.updated',
      ip_address: '103.21.58.14',
      before: { price: '4200.00', pausable: false, min_quantity: 5 },
      after: { price: '4500.00', pausable: true, min_quantity: 5 },
    },
    {
      id: 'aud-02',
      timestamp: '2026-10-30T15:42:08Z',
      actor_id: 'usr-staff-02',
      actor_email: 'vrindha@brightloop.io',
      actor_role: 'staff',
      entity: 'Subscription',
      entity_id: 'SUB-2026-000103',
      action: 'subscription.paused',
      ip_address: '103.21.58.19',
      before: { status: 'active', next_billing_date: '2026-10-10', paused_at: null },
      after: { status: 'paused', next_billing_date: null, paused_at: '2026-10-02T14:00:00Z' },
    },
    {
      id: 'aud-03',
      timestamp: '2026-10-28T16:30:40Z',
      actor_id: 'usr-staff-01',
      actor_email: 'nandana@brightloop.io',
      actor_role: 'staff',
      entity: 'Subscription',
      entity_id: 'SUB-2026-000104',
      action: 'subscription.transition',
      ip_address: '103.21.58.22',
      before: { status: 'draft', quote_valid_until: null },
      after: { status: 'quotation', quote_valid_until: '2026-11-15' },
    },
    {
      id: 'aud-04',
      timestamp: '2026-10-15T14:22:19Z',
      actor_id: 'usr-cust-01',
      actor_email: 'arjun@vervecloud.in',
      actor_role: 'customer',
      entity: 'Invoice',
      entity_id: 'INV-2026-000412',
      action: 'payment.recorded',
      ip_address: '49.207.194.88',
      before: { amount_paid: '0.00', balance: '62988.40' },
      after: { amount_paid: '20000.00', balance: '42988.40', method: 'upi' },
    },
    {
      id: 'aud-05',
      timestamp: '2026-09-12T11:05:00Z',
      actor_id: 'usr-admin-01',
      actor_email: 'admin@brightloop.io',
      actor_role: 'admin',
      entity: 'User',
      entity_id: 'usr-staff-02',
      action: 'staff.provisioned',
      ip_address: '103.21.58.14',
      before: null,
      after: { email: 'vrindha@brightloop.io', role: 'staff', is_active: true },
    },
  ];

  notifications: NotificationItem[] = [
    {
      id: 'notif-01',
      created_at: '2026-10-31T06:00:00Z',
      title: 'Overdue Invoice Alert',
      message: 'INV-2026-000412 (VerveCloud) has INR 42,988.40 overdue by 11 days.',
      type: 'warning',
      read: false,
    },
    {
      id: 'notif-02',
      created_at: '2026-10-30T18:10:00Z',
      title: 'Quotation Pending Confirmation',
      message: 'SUB-2026-000104 for Northstar Diagnostics is awaiting confirmation.',
      type: 'info',
      read: false,
    },
  ];

  processedIdempotencyKeys = new Map<string, MockHttpResponse>();

  recordAudit(
    actor: AuthUser | null,
    entity: string,
    entityId: string,
    action: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null
  ): void {
    this.auditLogs.unshift({
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      actor_id: actor?.id ?? 'system',
      actor_email: actor?.email ?? 'system@brightloop.io',
      actor_role: actor?.role ?? 'admin',
      entity,
      entity_id: entityId,
      action,
      ip_address: '127.0.0.1',
      before,
      after,
    });
  }
}

export const mockDb = new MockDatabase();

export function resetMockDatabase(): void {
  Object.assign(mockDb, new MockDatabase());
}

function sanitizeUser(u: MockUserRecord): AuthUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    customer_id: u.customer_id,
    failed_attempts: u.failed_attempts,
    locked_until: u.locked_until,
    last_login_at: u.last_login_at,
    created_at: u.created_at,
    is_active: u.is_active,
  };
}

function makeJwtToken(userId: string, role: string): string {
  const payload = btoa(JSON.stringify({ sub: userId, role, exp: Math.floor(Date.now() / 1000) + 900 }));
  return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.brightloop_sig`;
}

function err(status: number, code: string, message: string, fields: ApiErrorPayload['fields'] = []): MockHttpResponse {
  return {
    status,
    data: { code, message, fields } satisfies ApiErrorPayload,
  };
}

function paginate<T>(items: T[], query: URLSearchParams): PaginatedResponse<T> {
  const page = Math.max(1, Number.parseInt(query.get('page') ?? '1', 10) || 1);
  const pageSize = Math.max(1, Math.min(500, Number.parseInt(query.get('page_size') ?? '25', 10) || 25));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page,
    page_size: pageSize,
    total,
    total_pages: totalPages,
  };
}

function computeSubscriptionTotals(lines: SubscriptionLine[], discountTotalStr = '0.00'): Pick<Subscription, 'subtotal' | 'discount_total' | 'tax_total' | 'total' | 'lines'> {
  let subtotal = 0;
  let taxTotal = 0;
  const computedLines = lines.map((line) => {
    const qty = Math.max(1, line.quantity);
    const unit = parseMoney(line.unit_price);
    const rate = parseMoney(line.tax_rate);
    const rawLineSub = roundHalfUp(qty * unit);
    let lineSub = rawLineSub;
    let lineTax = 0;
    if (line.tax_inclusive && rate > 0) {
      const base = roundHalfUp(rawLineSub / (1 + rate / 100));
      lineTax = roundHalfUp(rawLineSub - base);
      lineSub = base;
    } else if (rate > 0) {
      lineTax = roundHalfUp((rawLineSub * rate) / 100);
    }
    const lineTot = roundHalfUp(lineSub + lineTax);
    subtotal = roundHalfUp(subtotal + lineSub);
    taxTotal = roundHalfUp(taxTotal + lineTax);
    return {
      ...line,
      quantity: qty,
      unit_price: toFixedMoney(unit),
      line_subtotal: toFixedMoney(lineSub),
      line_tax: toFixedMoney(lineTax),
      line_total: toFixedMoney(lineTot),
    };
  });
  const discount = Math.min(subtotal, parseMoney(discountTotalStr));
  const total = roundHalfUp(subtotal - discount + taxTotal);
  return {
    lines: computedLines,
    subtotal: toFixedMoney(subtotal),
    discount_total: toFixedMoney(discount),
    tax_total: toFixedMoney(taxTotal),
    total: toFixedMoney(total),
  };
}

function generateInvoicePdfBlob(invoice: Invoice): Blob {
  // Valid minimal single-page PDF binary stream rendered locally (zero external cloud PDF widgets!)
  const linesText = [
    `BRIGHTLOOP TAX INVOICE - ${invoice.number}`,
    `Customer: ${invoice.customer_name}`,
    `Status: ${invoice.status.toUpperCase()}   Issue Date: ${invoice.issue_date}   Due Date: ${invoice.due_date}`,
    `----------------------------------------------------------------`,
    ...invoice.lines.map(
      (l) => `${l.description.slice(0, 42)} | Qty ${l.quantity} | ${invoice.currency} ${l.line_total}`
    ),
    `----------------------------------------------------------------`,
    `Subtotal: ${invoice.currency} ${invoice.subtotal}   Discount: ${invoice.currency} ${invoice.discount_total}`,
    `Tax: ${invoice.currency} ${invoice.tax_total}   TOTAL: ${invoice.currency} ${invoice.total}`,
    `Paid: ${invoice.currency} ${invoice.amount_paid}   Balance Due: ${invoice.currency} ${invoice.balance}`,
  ];

  const escaped = linesText.map((t) => t.replace(/[()\\]/g, '')).map((t, idx) => `1 0 0 1 48 ${750 - idx * 22} Tm (${t}) Tj`).join('\n');
  const stream = `BT\n/F1 11 Tf\n${escaped}\nET`;
  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${stream.length} >> stream
${stream}
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
0000000${(293 + stream.length).toString().padStart(3, '0')} 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
${365 + stream.length}
%%EOF`;

  return new Blob([pdf], { type: 'application/pdf' });
}

export async function handleMockRequest(
  method: string,
  rawPath: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<MockHttpResponse> {
  // Subtle realistic latency (30ms) keeping every page well under <200ms!
  await new Promise((resolve) => setTimeout(resolve, 30));

  const url = new URL(rawPath.startsWith('http') ? rawPath : `http://localhost${rawPath}`);
  const path = url.pathname.replace(/^\/api\/v1/, '') || '/';
  const query = url.searchParams;
  const upperMethod = method.toUpperCase();
  const actor = tokenStore.getUser();
  const idempotencyKey = headers?.['Idempotency-Key'] ?? headers?.['idempotency-key'];

  if (idempotencyKey && mockDb.processedIdempotencyKeys.has(idempotencyKey)) {
    return mockDb.processedIdempotencyKeys.get(idempotencyKey)!;
  }

  const payload = (body && typeof body === 'object' ? (body as Record<string, unknown>) : {}) as Record<string, unknown>;

  // ================= AUTH & USERS =================
  if (upperMethod === 'POST' && path === '/auth/login') {
    const email = normalizeEmail(String(payload.email ?? ''));
    const password = String(payload.password ?? '');
    const user = mockDb.users.find((u) => u.email === email);

    if (!user) {
      return err(401, 'UNAUTHORIZED', 'Invalid email or password.');
    }

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      return err(
        423,
        'ACCOUNT_LOCKED',
        `Account temporarily locked due to repeated failed attempts. Try again after ${new Date(user.locked_until).toLocaleTimeString()}.`
      );
    }

    if (user.password !== password) {
      user.failed_attempts = (user.failed_attempts ?? 0) + 1;
      if (user.failed_attempts >= 5) {
        user.locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        return err(
          423,
          'ACCOUNT_LOCKED',
          'Account locked for 15 minutes after 5 consecutive failed sign-in attempts.'
        );
      }
      return err(401, 'UNAUTHORIZED', `Invalid email or password (${5 - user.failed_attempts} attempts remaining).`);
    }

    user.failed_attempts = 0;
    user.locked_until = null;
    user.last_login_at = new Date().toISOString();

    const authResp: AuthResponse = {
      access_token: makeJwtToken(user.id, user.role),
      token_type: 'bearer',
      expires_in: 900,
      user: sanitizeUser(user),
    };
    return { status: 200, data: authResp };
  }

  if (upperMethod === 'POST' && path === '/auth/signup') {
    const email = normalizeEmail(String(payload.email ?? ''));
    const password = String(payload.password ?? '');
    const name = String(payload.name ?? '').trim();
    const companyName = String(payload.company_name ?? '').trim();

    const fieldErrors: ApiErrorPayload['fields'] = [];
    if (!name) fieldErrors.push({ field: 'name', message: 'Full name is required.' });
    if (!isValidEmail(email)) fieldErrors.push({ field: 'email', message: 'Enter a valid email address.' });
    if (!evaluatePasswordStrength(password).isValid) {
      fieldErrors.push({
        field: 'password',
        message: 'Password must contain at least 9 characters with uppercase, lowercase, and special character.',
      });
    }
    if (fieldErrors.length > 0) {
      return err(422, 'VALIDATION_ERROR', 'Please fix the highlighted fields.', fieldErrors);
    }

    if (mockDb.users.some((u) => u.email === email)) {
      return err(409, 'CONFLICT', 'Email already taken.', [{ field: 'email', message: 'Email already taken.' }]);
    }

    const customerId = `cust-${Date.now()}`;
    const newCustomer: Customer = {
      id: customerId,
      name,
      email,
      phone: '',
      company_name: companyName || `${name} Workspace`,
      tax_id: '',
      billing_address: { line1: '', city: '', state: '', postal_code: '', country: 'India' },
      status: 'active',
      portal_user_linked: true,
      created_at: new Date().toISOString(),
    };
    mockDb.customers.unshift(newCustomer);

    const newUser: MockUserRecord = {
      id: `usr-${Date.now()}`,
      email,
      name,
      role: 'customer',
      customer_id: customerId,
      password,
      failed_attempts: 0,
      locked_until: null,
      last_login_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      is_active: true,
    };
    mockDb.users.push(newUser);
    mockDb.recordAudit(sanitizeUser(newUser), 'User', newUser.id, 'customer.signup', null, { email, role: 'customer' });

    const authResp: AuthResponse = {
      access_token: makeJwtToken(newUser.id, newUser.role),
      token_type: 'bearer',
      expires_in: 900,
      user: sanitizeUser(newUser),
    };
    return { status: 201, data: authResp };
  }

  if (upperMethod === 'POST' && path === '/auth/refresh') {
    const hintId = tokenStore.getRefreshHintUserId();
    const user = mockDb.users.find((u) => u.id === hintId);
    if (!user) {
      return err(401, 'UNAUTHORIZED', 'Refresh session expired.');
    }
    return {
      status: 200,
      data: {
        access_token: makeJwtToken(user.id, user.role),
        token_type: 'bearer',
        expires_in: 900,
        user: sanitizeUser(user),
      } satisfies AuthResponse,
    };
  }

  if (upperMethod === 'POST' && path === '/auth/logout') {
    return { status: 204 };
  }

  if (upperMethod === 'POST' && path === '/auth/forgot-password') {
    return {
      status: 200,
      data: { message: 'If the email exists, a link was sent' },
    };
  }

  if (upperMethod === 'POST' && path === '/auth/reset-password') {
    const token = String(payload.token ?? '').trim();
    const newPassword = String(payload.new_password ?? '');
    if (!token) {
      return err(422, 'VALIDATION_ERROR', 'Reset token is required.', [{ field: 'token', message: 'Reset token is required.' }]);
    }
    if (!evaluatePasswordStrength(newPassword).isValid) {
      return err(422, 'VALIDATION_ERROR', 'Weak password.', [
        { field: 'new_password', message: 'Password must meet all security requirements.' },
      ]);
    }
    return { status: 200, data: { message: 'Password updated successfully. Please sign in.' } };
  }

  // Staff list & creation (Admin only)
  if (path === '/users/staff') {
    if (actor?.role !== 'admin') {
      return err(403, 'FORBIDDEN', 'Admin privilege required.');
    }
    if (upperMethod === 'GET') {
      const staffUsers = mockDb.users.filter((u) => u.role === 'admin' || u.role === 'staff').map(sanitizeUser);
      return { status: 200, data: staffUsers };
    }
    if (upperMethod === 'POST') {
      const email = normalizeEmail(String(payload.email ?? ''));
      const name = String(payload.name ?? '').trim() || email.split('@')[0];
      const role = payload.role === 'admin' ? 'admin' : 'staff';
      const tempPassword = String(payload.temp_password ?? 'Staff@2026!');

      if (!isValidEmail(email)) {
        return err(422, 'VALIDATION_ERROR', 'Invalid email address.', [{ field: 'email', message: 'Valid work email required.' }]);
      }
      if (mockDb.users.some((u) => u.email === email)) {
        return err(409, 'CONFLICT', 'User account already exists.', [{ field: 'email', message: 'Email is already registered.' }]);
      }
      const created: MockUserRecord = {
        id: `usr-staff-${Date.now()}`,
        email,
        name,
        role,
        customer_id: null,
        password: tempPassword,
        failed_attempts: 0,
        locked_until: null,
        last_login_at: null,
        created_at: new Date().toISOString(),
        is_active: true,
      };
      mockDb.users.unshift(created);
      mockDb.recordAudit(actor, 'User', created.id, 'staff.provisioned', null, { email, name, role });
      return { status: 201, data: sanitizeUser(created) };
    }
  }

  const staffToggleMatch = path.match(/^\/users\/staff\/([^/]+)$/);
  if (staffToggleMatch && upperMethod === 'PATCH') {
    if (actor?.role !== 'admin') return err(403, 'FORBIDDEN', 'Admin privilege required.');
    const target = mockDb.users.find((u) => u.id === staffToggleMatch[1]);
    if (!target) return err(404, 'NOT_FOUND', 'User not found.');
    const before = { role: target.role, is_active: target.is_active };
    if (typeof payload.is_active === 'boolean') target.is_active = payload.is_active;
    if (payload.role === 'admin' || payload.role === 'staff') target.role = payload.role;
    mockDb.recordAudit(actor, 'User', target.id, 'staff.updated', before, { role: target.role, is_active: target.is_active });
    return { status: 200, data: sanitizeUser(target) };
  }

  // ================= AUDIT LOGS & SETTINGS & NOTIFICATIONS =================
  if (upperMethod === 'GET' && path === '/audit-logs') {
    if (actor?.role !== 'admin') return err(403, 'FORBIDDEN', 'Admin privilege required.');
    const search = (query.get('search') ?? '').toLowerCase();
    const entity = query.get('entity') ?? '';
    const filtered = mockDb.auditLogs.filter((entry) => {
      if (entity && entry.entity.toLowerCase() !== entity.toLowerCase()) return false;
      if (search) {
        const hay = `${entry.actor_email} ${entry.entity} ${entry.entity_id} ${entry.action}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
    return { status: 200, data: paginate(filtered, query) };
  }

  if (path === '/settings') {
    if (upperMethod === 'GET') {
      return { status: 200, data: mockDb.settings };
    }
    if (upperMethod === 'PATCH') {
      if (actor?.role !== 'admin') return err(403, 'FORBIDDEN', 'Admin privilege required.');
      const before = { ...mockDb.settings };
      mockDb.settings = { ...mockDb.settings, ...(payload as Partial<SystemSettings>) };
      mockDb.recordAudit(actor, 'Settings', 'global', 'settings.updated', before, { ...mockDb.settings });
      return { status: 200, data: mockDb.settings };
    }
  }

  if (path === '/notifications') {
    if (upperMethod === 'GET') {
      return { status: 200, data: mockDb.notifications };
    }
    if (upperMethod === 'POST') {
      const item: NotificationItem = {
        id: `notif-${Date.now()}`,
        created_at: new Date().toISOString(),
        title: String(payload.title ?? 'Notification'),
        message: String(payload.message ?? ''),
        type: (payload.type as NotificationItem['type']) ?? 'info',
        read: false,
      };
      mockDb.notifications.unshift(item);
      return { status: 201, data: item };
    }
  }

  // ================= CUSTOMERS =================
  if (path === '/customers') {
    if (upperMethod === 'GET') {
      const search = (query.get('search') ?? '').toLowerCase();
      const status = query.get('status') ?? '';
      const filtered = mockDb.customers.filter((c) => {
        if (status && c.status !== status) return false;
        if (search) {
          const hay = `${c.name} ${c.email} ${c.company_name} ${c.tax_id}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      });
      return { status: 200, data: paginate(filtered, query) };
    }
    if (upperMethod === 'POST') {
      const name = String(payload.name ?? '').trim();
      const email = normalizeEmail(String(payload.email ?? ''));
      if (!name || !isValidEmail(email)) {
        return err(422, 'VALIDATION_ERROR', 'Valid customer name and email are required.', [
          ...(!name ? [{ field: 'name', message: 'Customer name is required.' }] : []),
          ...(!isValidEmail(email) ? [{ field: 'email', message: 'Valid email is required.' }] : []),
        ]);
      }
      const created: Customer = {
        id: `cust-${Date.now()}`,
        name,
        email,
        phone: String(payload.phone ?? ''),
        company_name: String(payload.company_name ?? name),
        tax_id: String(payload.tax_id ?? ''),
        billing_address: (payload.billing_address as Customer['billing_address']) ?? {
          line1: '',
          city: '',
          state: '',
          postal_code: '',
          country: 'India',
        },
        status: 'active',
        portal_user_linked: false,
        created_at: new Date().toISOString(),
      };
      mockDb.customers.unshift(created);
      mockDb.recordAudit(actor, 'Customer', created.id, 'customer.created', null, { name, email, company_name: created.company_name });
      return { status: 201, data: created };
    }
  }

  const custMatch = path.match(/^\/customers\/([^/]+)$/);
  if (custMatch) {
    const cust = mockDb.customers.find((c) => c.id === custMatch[1]);
    if (!cust) return err(404, 'NOT_FOUND', 'Customer not found.');
    if (upperMethod === 'GET') {
      return {
        status: 200,
        data: {
          customer: cust,
          subscriptions: mockDb.subscriptions.filter((s) => s.customer_id === cust.id),
          invoices: mockDb.invoices.filter((i) => i.customer_id === cust.id),
          payments: mockDb.payments.filter((p) => p.customer_id === cust.id),
        },
      };
    }
    if (upperMethod === 'PATCH') {
      const before = { ...cust };
      Object.assign(cust, payload);
      mockDb.recordAudit(actor, 'Customer', cust.id, 'customer.updated', before, { ...cust });
      return { status: 200, data: cust };
    }
  }

  // ================= PRODUCTS & VARIANTS =================
  if (path === '/products') {
    if (upperMethod === 'GET') {
      return { status: 200, data: mockDb.products };
    }
    if (upperMethod === 'POST') {
      if (actor?.role !== 'admin') return err(403, 'FORBIDDEN', 'Only Admin can create products.');
      const created: Product = {
        id: `prod-${Date.now()}`,
        name: String(payload.name ?? ''),
        type: (payload.type as Product['type']) ?? 'software',
        sales_price: toFixedMoney(String(payload.sales_price ?? '0')),
        cost_price: toFixedMoney(String(payload.cost_price ?? '0')),
        tax_id: (payload.tax_id as string) ?? 'tax-gst-18',
        notes: String(payload.notes ?? ''),
        is_active: true,
        variants: [],
      };
      mockDb.products.unshift(created);
      mockDb.recordAudit(actor, 'Product', created.id, 'product.created', null, { name: created.name, sales_price: created.sales_price });
      return { status: 201, data: created };
    }
  }

  const prodVariantMatch = path.match(/^\/products\/([^/]+)\/variants$/);
  if (prodVariantMatch && upperMethod === 'POST') {
    if (actor?.role !== 'admin') return err(403, 'FORBIDDEN', 'Only Admin can add variants.');
    const prod = mockDb.products.find((p) => p.id === prodVariantMatch[1]);
    if (!prod) return err(404, 'NOT_FOUND', 'Product not found.');
    const variant = {
      id: `var-${Date.now()}`,
      product_id: prod.id,
      attribute: String(payload.attribute ?? ''),
      value: String(payload.value ?? ''),
      extra_price: toFixedMoney(String(payload.extra_price ?? '0')),
    };
    prod.variants.push(variant);
    mockDb.recordAudit(actor, 'ProductVariant', variant.id, 'variant.created', null, variant);
    return { status: 201, data: variant };
  }

  const prodMatch = path.match(/^\/products\/([^/]+)$/);
  if (prodMatch) {
    const idx = mockDb.products.findIndex((p) => p.id === prodMatch[1]);
    if (idx === -1) return err(404, 'NOT_FOUND', 'Product not found.');
    if (upperMethod === 'GET') return { status: 200, data: mockDb.products[idx] };
    if (actor?.role !== 'admin') return err(403, 'FORBIDDEN', 'Admin privilege required.');
    if (upperMethod === 'PATCH') {
      const before = { ...mockDb.products[idx] };
      mockDb.products[idx] = { ...mockDb.products[idx], ...(payload as Partial<Product>) };
      mockDb.recordAudit(actor, 'Product', prodMatch[1], 'product.updated', before, { ...mockDb.products[idx] });
      return { status: 200, data: mockDb.products[idx] };
    }
    if (upperMethod === 'DELETE') {
      const removed = mockDb.products.splice(idx, 1)[0];
      mockDb.recordAudit(actor, 'Product', removed.id, 'product.deleted', { name: removed.name }, null);
      return { status: 204 };
    }
  }

  // ================= PLANS =================
  if (path === '/plans') {
    if (upperMethod === 'GET') return { status: 200, data: mockDb.plans };
    if (upperMethod === 'POST') {
      if (actor?.role !== 'admin') return err(403, 'FORBIDDEN', 'Admin privilege required.');
      const created: Plan = {
        id: `plan-${Date.now()}`,
        name: String(payload.name ?? ''),
        price: toFixedMoney(String(payload.price ?? '0')),
        billing_period: (payload.billing_period as Plan['billing_period']) ?? 'monthly',
        min_quantity: Math.max(1, Number(payload.min_quantity ?? 1)),
        valid_from: String(payload.valid_from ?? todayIsoDate()),
        valid_to: payload.valid_to ? String(payload.valid_to) : null,
        auto_close: Boolean(payload.auto_close),
        closable: payload.closable !== undefined ? Boolean(payload.closable) : true,
        pausable: Boolean(payload.pausable),
        renewable: payload.renewable !== undefined ? Boolean(payload.renewable) : true,
        is_active: payload.is_active !== undefined ? Boolean(payload.is_active) : true,
      };
      mockDb.plans.unshift(created);
      mockDb.recordAudit(actor, 'Plan', created.id, 'plan.created', null, { ...created });
      return { status: 201, data: created };
    }
  }

  const planMatch = path.match(/^\/plans\/([^/]+)$/);
  if (planMatch && upperMethod === 'PATCH') {
    if (actor?.role !== 'admin') return err(403, 'FORBIDDEN', 'Admin privilege required.');
    const plan = mockDb.plans.find((p) => p.id === planMatch[1]);
    if (!plan) return err(404, 'NOT_FOUND', 'Plan not found.');
    const before = { ...plan };
    Object.assign(plan, payload);
    if (payload.price !== undefined) plan.price = toFixedMoney(String(payload.price));
    mockDb.recordAudit(actor, 'Plan', plan.id, 'plan.updated', before, { ...plan });
    return { status: 200, data: plan };
  }

  // ================= TAXES & DISCOUNTS =================
  if (path === '/taxes') {
    if (upperMethod === 'GET') return { status: 200, data: mockDb.taxes };
    if (actor?.role !== 'admin') return err(403, 'FORBIDDEN', 'Admin privilege required.');
    if (upperMethod === 'POST') {
      const created: TaxRule = {
        id: `tax-${Date.now()}`,
        name: String(payload.name ?? ''),
        type: (payload.type as TaxRule['type']) ?? 'percent',
        rate: toFixedMoney(String(payload.rate ?? '0')),
        inclusive: Boolean(payload.inclusive),
        applies_to: (payload.applies_to as TaxRule['applies_to']) ?? 'all',
        is_active: payload.is_active !== undefined ? Boolean(payload.is_active) : true,
      };
      mockDb.taxes.push(created);
      mockDb.recordAudit(actor, 'TaxRule', created.id, 'tax.created', null, { ...created });
      return { status: 201, data: created };
    }
    if (upperMethod === 'PATCH') {
      const tax = mockDb.taxes.find((t) => t.id === payload.id);
      if (!tax) return err(404, 'NOT_FOUND', 'Tax rule not found.');
      const before = { ...tax };
      Object.assign(tax, payload);
      if (payload.rate !== undefined) tax.rate = toFixedMoney(String(payload.rate));
      mockDb.recordAudit(actor, 'TaxRule', tax.id, 'tax.updated', before, { ...tax });
      return { status: 200, data: tax };
    }
  }

  if (path === '/discounts') {
    if (upperMethod === 'GET') return { status: 200, data: mockDb.discounts };
    if (actor?.role !== 'admin') return err(403, 'FORBIDDEN', 'Admin privilege required.');
    if (upperMethod === 'POST') {
      const created: DiscountRule = {
        id: `disc-${Date.now()}`,
        name: String(payload.name ?? ''),
        code: payload.code ? String(payload.code).toUpperCase() : undefined,
        type: (payload.type as DiscountRule['type']) ?? 'percent',
        value: toFixedMoney(String(payload.value ?? '0')),
        min_purchase_amount: toFixedMoney(String(payload.min_purchase_amount ?? '0')),
        min_quantity: Math.max(1, Number(payload.min_quantity ?? 1)),
        start_date: String(payload.start_date ?? todayIsoDate()),
        end_date: payload.end_date ? String(payload.end_date) : null,
        usage_limit: payload.usage_limit ? Number(payload.usage_limit) : null,
        usage_count: 0,
        scope: (payload.scope as DiscountRule['scope']) ?? 'subscription',
        product_ids: (payload.product_ids as string[]) ?? [],
        is_active: payload.is_active !== undefined ? Boolean(payload.is_active) : true,
      };
      mockDb.discounts.unshift(created);
      mockDb.recordAudit(actor, 'DiscountRule', created.id, 'discount.created', null, { ...created });
      return { status: 201, data: created };
    }
    if (upperMethod === 'PATCH') {
      const disc = mockDb.discounts.find((d) => d.id === payload.id);
      if (!disc) return err(404, 'NOT_FOUND', 'Discount rule not found.');
      const before = { ...disc };
      Object.assign(disc, payload);
      mockDb.recordAudit(actor, 'DiscountRule', disc.id, 'discount.updated', before, { ...disc });
      return { status: 200, data: disc };
    }
  }

  const discUsageMatch = path.match(/^\/discounts\/([^/]+)\/usage$/);
  if (discUsageMatch && upperMethod === 'GET') {
    const disc = mockDb.discounts.find((d) => d.id === discUsageMatch[1]);
    if (!disc) return err(404, 'NOT_FOUND', 'Discount not found.');
    return { status: 200, data: { id: disc.id, usage_count: disc.usage_count, usage_limit: disc.usage_limit } };
  }

  // ================= QUOTATION TEMPLATES =================
  if (path === '/quotation-templates') {
    if (upperMethod === 'GET') return { status: 200, data: mockDb.templates };
    if (upperMethod === 'POST') {
      const plan = mockDb.plans.find((p) => p.id === payload.plan_id) ?? mockDb.plans[0];
      const created: QuotationTemplate = {
        id: `tpl-${Date.now()}`,
        name: String(payload.name ?? ''),
        validity_days: Math.max(1, Number(payload.validity_days ?? 15)),
        plan_id: plan.id,
        plan_name: plan.name,
        notes: String(payload.notes ?? ''),
        lines: (payload.lines as QuotationTemplate['lines']) ?? [],
      };
      mockDb.templates.unshift(created);
      mockDb.recordAudit(actor, 'QuotationTemplate', created.id, 'template.created', null, { name: created.name });
      return { status: 201, data: created };
    }
  }

  const tplCreateQuoteMatch = path.match(/^\/quotation-templates\/([^/]+)\/create-quotation$/);
  if (tplCreateQuoteMatch && upperMethod === 'POST') {
    const tpl = mockDb.templates.find((t) => t.id === tplCreateQuoteMatch[1]);
    if (!tpl) return err(404, 'NOT_FOUND', 'Template not found.');
    const cust =
      mockDb.customers.find((c) => c.id === payload.customer_id) ??
      mockDb.customers.find((c) => c.status === 'active')!;
    const plan = mockDb.plans.find((p) => p.id === tpl.plan_id) ?? mockDb.plans[0];
    const rawLines: SubscriptionLine[] = tpl.lines.map((l, idx) => ({
      id: `sline-${Date.now()}-${idx}`,
      product_id: l.product_id,
      product_name: l.product_name,
      variant_id: l.variant_id,
      variant_label: l.variant_label ?? null,
      quantity: Math.max(plan.min_quantity, l.quantity),
      unit_price: l.unit_price,
      tax_rate: '18.00',
      tax_inclusive: false,
      line_subtotal: '0.00',
      line_tax: '0.00',
      line_total: '0.00',
    }));
    const totals = computeSubscriptionTotals(rawLines);
    const validUntil = new Date(Date.now() + tpl.validity_days * 86400000).toISOString().slice(0, 10);
    const nextNum = `${mockDb.settings.subscription_prefix}${String(101 + mockDb.subscriptions.length).padStart(6, '0')}`;
    const newSub: Subscription = {
      id: `sub-${Date.now()}`,
      number: nextNum,
      customer_id: cust.id,
      customer_name: cust.company_name,
      plan_id: plan.id,
      plan_name: plan.name,
      billing_period: plan.billing_period,
      status: 'draft',
      payment_terms: 'Net 15',
      anchor_day: new Date().getDate(),
      start_date: null,
      expiry_date: null,
      next_billing_date: null,
      last_billed_through: null,
      quote_valid_until: validUntil,
      paused_at: null,
      closed_at: null,
      currency: mockDb.settings.currency,
      ...totals,
      activities: [
        {
          id: `act-${Date.now()}`,
          timestamp: new Date().toISOString(),
          actor_email: actor?.email ?? 'staff@brightloop.io',
          action: 'Draft Created from Template',
          note: `Generated from template "${tpl.name}".`,
        },
      ],
    };
    mockDb.subscriptions.unshift(newSub);
    mockDb.recordAudit(actor, 'Subscription', newSub.number, 'subscription.created_from_template', null, { template: tpl.name });
    return { status: 201, data: newSub };
  }

  // ================= SUBSCRIPTIONS =================
  if (path === '/subscriptions') {
    if (upperMethod === 'GET') {
      const status = query.get('status') ?? '';
      const customerId = query.get('customer_id') ?? '';
      const planId = query.get('plan_id') ?? '';
      const search = (query.get('search') ?? '').toLowerCase();
      const filtered = mockDb.subscriptions.filter((s) => {
        if (status && s.status !== status) return false;
        if (customerId && s.customer_id !== customerId) return false;
        if (planId && s.plan_id !== planId) return false;
        if (search) {
          const hay = `${s.number} ${s.customer_name} ${s.plan_name}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      });
      return { status: 200, data: paginate(filtered, query) };
    }
    if (upperMethod === 'POST') {
      const cust = mockDb.customers.find((c) => c.id === payload.customer_id);
      const plan = mockDb.plans.find((p) => p.id === payload.plan_id);
      if (!cust || !plan) {
        return err(422, 'VALIDATION_ERROR', 'Customer and Plan are required.');
      }
      const inputLines = (payload.lines as SubscriptionLine[]) ?? [];
      const totals = computeSubscriptionTotals(inputLines, String(payload.discount_total ?? '0.00'));
      const nextNum = `${mockDb.settings.subscription_prefix}${String(101 + mockDb.subscriptions.length).padStart(6, '0')}`;
      const created: Subscription = {
        id: `sub-${Date.now()}`,
        number: nextNum,
        customer_id: cust.id,
        customer_name: cust.company_name,
        plan_id: plan.id,
        plan_name: plan.name,
        billing_period: plan.billing_period,
        status: 'draft',
        payment_terms: (payload.payment_terms as Subscription['payment_terms']) ?? 'Net 15',
        anchor_day: new Date().getDate(),
        start_date: null,
        expiry_date: null,
        next_billing_date: null,
        last_billed_through: null,
        quote_valid_until: String(payload.quote_valid_until ?? new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10)),
        paused_at: null,
        closed_at: null,
        coupon_code: payload.coupon_code ? String(payload.coupon_code) : null,
        currency: mockDb.settings.currency,
        ...totals,
        activities: [
          {
            id: `act-${Date.now()}`,
            timestamp: new Date().toISOString(),
            actor_email: actor?.email ?? 'staff@brightloop.io',
            action: 'Draft Created',
            note: 'Subscription initialized in Draft.',
          },
        ],
      };
      mockDb.subscriptions.unshift(created);
      mockDb.recordAudit(actor, 'Subscription', created.number, 'subscription.created', null, { status: 'draft', total: created.total });
      return { status: 201, data: created };
    }
  }

  const subActionMatch = path.match(/^\/subscriptions\/([^/]+)\/(transition|pause|resume|close|renew)$/);
  if (subActionMatch && upperMethod === 'POST') {
    const [, subId, action] = subActionMatch;
    const sub = mockDb.subscriptions.find((s) => s.id === subId);
    if (!sub) return err(404, 'NOT_FOUND', 'Subscription not found.');
    const plan = mockDb.plans.find((p) => p.id === sub.plan_id);
    const beforeState = sub.status;

    if (action === 'pause') {
      if (!plan?.pausable) return err(409, 'CONFLICT', 'Selected plan does not permit pausing.');
      if (sub.status !== 'active') return err(409, 'CONFLICT', 'Only Active subscriptions can be paused.');
      sub.status = 'paused';
      sub.paused_at = new Date().toISOString();
      sub.next_billing_date = null;
      sub.activities.unshift({
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor_email: actor?.email ?? 'staff@brightloop.io',
        action: 'Paused',
        note: 'Billing skips paused periods.',
      });
    } else if (action === 'resume') {
      if (sub.status !== 'paused') return err(409, 'CONFLICT', 'Only Paused subscriptions can be resumed.');
      sub.status = 'active';
      sub.paused_at = null;
      sub.next_billing_date = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      sub.activities.unshift({
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor_email: actor?.email ?? 'staff@brightloop.io',
        action: 'Resumed',
        note: `Recomputed next billing date to ${sub.next_billing_date}.`,
      });
    } else if (action === 'close') {
      if (!plan?.closable) return err(409, 'CONFLICT', 'Selected plan does not allow manual closure.');
      const reason = String(payload.close_reason ?? '').trim();
      if (!reason) {
        return err(422, 'VALIDATION_ERROR', 'Close reason is mandatory.', [
          { field: 'close_reason', message: 'Please specify a reason for closing this subscription.' },
        ]);
      }
      sub.status = 'closed';
      sub.closed_at = new Date().toISOString();
      sub.close_reason = reason;
      sub.next_billing_date = null;
      sub.activities.unshift({
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor_email: actor?.email ?? 'staff@brightloop.io',
        action: 'Closed',
        note: reason,
      });
    } else if (action === 'renew') {
      if (!plan?.renewable) return err(409, 'CONFLICT', 'Selected plan is non-renewable.');
      if (sub.status !== 'closed') return err(409, 'CONFLICT', 'Only Closed subscriptions can be renewed.');
      sub.status = 'active';
      sub.closed_at = null;
      sub.start_date = todayIsoDate();
      sub.next_billing_date = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      sub.activities.unshift({
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor_email: actor?.email ?? 'staff@brightloop.io',
        action: 'Renewed',
        note: `Renewed for a fresh billing term starting ${sub.start_date}.`,
      });
    } else if (action === 'transition') {
      const target = String(payload.target ?? '') as SubscriptionStatus;
      const legal: Record<SubscriptionStatus, SubscriptionStatus[]> = {
        draft: ['quotation', 'cancelled'],
        quotation: ['confirmed', 'cancelled'],
        confirmed: ['active', 'cancelled'],
        active: ['paused', 'closed'],
        paused: ['active', 'closed'],
        closed: ['active'],
        cancelled: [],
      };
      if (!legal[sub.status]?.includes(target)) {
        return err(409, 'CONFLICT', `Illegal state transition from "${sub.status}" to "${target}".`);
      }
      sub.status = target;
      if (target === 'quotation' && !sub.quote_valid_until) {
        sub.quote_valid_until = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
      }
      if (target === 'active') {
        sub.start_date = todayIsoDate();
        sub.next_billing_date = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      }
      sub.activities.unshift({
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor_email: actor?.email ?? 'staff@brightloop.io',
        action: `Transition -> ${target}`,
        note: `State updated from ${beforeState} to ${target}.`,
      });
    }

    mockDb.recordAudit(actor, 'Subscription', sub.number, `subscription.${action}`, { status: beforeState }, { status: sub.status });
    return { status: 200, data: sub };
  }

  const subDetailMatch = path.match(/^\/subscriptions\/([^/]+)$/);
  if (subDetailMatch) {
    const subIdx = mockDb.subscriptions.findIndex((s) => s.id === subDetailMatch[1]);
    if (subIdx === -1) return err(404, 'NOT_FOUND', 'Subscription not found.');
    const sub = mockDb.subscriptions[subIdx];
    if (upperMethod === 'GET') return { status: 200, data: sub };
    if (upperMethod === 'PATCH') {
      if (sub.status !== 'draft') {
        return err(409, 'CONFLICT', 'Line items can only be edited while subscription is in Draft status.');
      }
      const nextLines = (payload.lines as SubscriptionLine[]) ?? sub.lines;
      const totals = computeSubscriptionTotals(nextLines, String(payload.discount_total ?? sub.discount_total));
      Object.assign(sub, payload, totals);
      mockDb.recordAudit(actor, 'Subscription', sub.number, 'subscription.draft_edited', null, { total: sub.total });
      return { status: 200, data: sub };
    }
    if (upperMethod === 'DELETE') {
      if (actor?.role !== 'admin') return err(403, 'FORBIDDEN', 'Staff role cannot delete subscriptions.');
      mockDb.subscriptions.splice(subIdx, 1);
      return { status: 204 };
    }
  }

  // ================= INVOICES & BILLING RUN =================
  if (path === '/invoices' && upperMethod === 'GET') {
    const status = query.get('status') ?? '';
    const customerId = query.get('customer_id') ?? '';
    const search = (query.get('search') ?? '').toLowerCase();
    const overdueOnly = query.get('overdue') === 'true';
    const filtered = mockDb.invoices.filter((inv) => {
      if (overdueOnly && !isInvoiceOverdue(inv)) return false;
      if (status && inv.status !== status) return false;
      if (customerId && inv.customer_id !== customerId) return false;
      if (search) {
        const hay = `${inv.number} ${inv.customer_name} ${inv.subscription_number ?? ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
    return { status: 200, data: paginate(filtered, query) };
  }

  const invPdfMatch = path.match(/^\/invoices\/([^/]+)\/pdf$/);
  if (invPdfMatch && upperMethod === 'GET') {
    const inv = mockDb.invoices.find((i) => i.id === invPdfMatch[1]);
    if (!inv) return err(404, 'NOT_FOUND', 'Invoice not found.');
    return { status: 200, blob: generateInvoicePdfBlob(inv) };
  }

  const invActionMatch = path.match(/^\/invoices\/([^/]+)\/(confirm|cancel|send|remind)$/);
  if (invActionMatch && upperMethod === 'POST') {
    const [, invId, action] = invActionMatch;
    const inv = mockDb.invoices.find((i) => i.id === invId);
    if (!inv) return err(404, 'NOT_FOUND', 'Invoice not found.');
    const before = { status: inv.status, sent_at: inv.sent_at };

    if (action === 'confirm') {
      if (inv.status !== 'draft') return err(409, 'CONFLICT', 'Only Draft invoices can be confirmed.');
      inv.status = 'confirmed';
    } else if (action === 'cancel') {
      if (inv.status === 'paid') {
        return err(409, 'CONFLICT', 'Paid invoices cannot be cancelled. Issue a Credit Note instead.');
      }
      inv.status = 'cancelled';
      inv.balance = '0.00';
      if (inv.discount_name) inv.discount_released = true;
    } else if (action === 'send' || action === 'remind') {
      inv.sent_at = new Date().toISOString();
      if (action === 'remind') {
        mockDb.notifications.unshift({
          id: `notif-${Date.now()}`,
          created_at: inv.sent_at,
          title: `Dunning Reminder Dispatched — ${inv.number}`,
          message: `Overdue payment reminder sent to ${inv.customer_name} for ${inv.currency} ${inv.balance}.`,
          type: 'warning',
          read: false,
        });
      }
    }

    mockDb.recordAudit(actor, 'Invoice', inv.number, `invoice.${action}`, before, { status: inv.status, sent_at: inv.sent_at });
    return { status: 200, data: inv };
  }

  const invPaymentMatch = path.match(/^\/invoices\/([^/]+)\/payments$/);
  if (invPaymentMatch && upperMethod === 'POST') {
    const inv = mockDb.invoices.find((i) => i.id === invPaymentMatch[1]);
    if (!inv) return err(404, 'NOT_FOUND', 'Invoice not found.');
    const amount = parseMoney(String(payload.amount ?? '0'));
    const balance = parseMoney(inv.balance);

    if (amount <= 0) {
      return err(422, 'VALIDATION_ERROR', 'Payment amount must be greater than zero.', [
        { field: 'amount', message: 'Enter a positive payment amount.' },
      ]);
    }
    if (amount > balance + 0.001) {
      return err(422, 'VALIDATION_ERROR', 'Overpayment blocked: amount exceeds invoice balance.', [
        { field: 'amount', message: `Amount cannot exceed remaining balance (${inv.currency} ${inv.balance}).` },
      ]);
    }

    const payment: PaymentRecord = {
      id: `pay-${Date.now()}`,
      invoice_id: inv.id,
      invoice_number: inv.number,
      customer_id: inv.customer_id,
      customer_name: inv.customer_name,
      method: (payload.method as PaymentMethod) ?? 'bank_transfer',
      amount: toFixedMoney(amount),
      currency: inv.currency,
      payment_date: String(payload.payment_date ?? new Date().toISOString()),
      reference: String(payload.reference ?? `REF-${Date.now().toString().slice(-6)}`),
      note: String(payload.note ?? ''),
      is_reversal: false,
    };
    mockDb.payments.unshift(payment);

    const newPaid = roundHalfUp(parseMoney(inv.amount_paid) + amount);
    const newBal = Math.max(0, roundHalfUp(parseMoney(inv.total) - newPaid));
    inv.amount_paid = toFixedMoney(newPaid);
    inv.balance = toFixedMoney(newBal);
    if (newBal === 0) inv.status = 'paid';

    mockDb.recordAudit(actor, 'Payment', payment.id, 'payment.recorded', { invoice_balance: toFixedMoney(balance) }, { amount: payment.amount, new_balance: inv.balance });
    const response: MockHttpResponse = { status: 201, data: { payment, invoice: inv } };
    if (idempotencyKey) mockDb.processedIdempotencyKeys.set(idempotencyKey, response);
    return response;
  }

  const invDetailMatch = path.match(/^\/invoices\/([^/]+)$/);
  if (invDetailMatch && upperMethod === 'GET') {
    const inv = mockDb.invoices.find((i) => i.id === invDetailMatch[1]);
    if (!inv) return err(404, 'NOT_FOUND', 'Invoice not found.');
    return { status: 200, data: { invoice: inv, payments: mockDb.payments.filter((p) => p.invoice_id === inv.id) } };
  }

  if (path === '/billing/run' && upperMethod === 'POST') {
    if (actor?.role !== 'admin') return err(403, 'FORBIDDEN', 'Only Admin can trigger manual billing runs.');
    const activeSubs = mockDb.subscriptions.filter((s) => s.status === 'active');
    const pausedSubs = mockDb.subscriptions.filter((s) => s.status === 'paused');

    let createdCount = 0;
    activeSubs.slice(0, 1).forEach((sub) => {
      createdCount += 1;
      const nextNum = `${mockDb.settings.invoice_prefix}${String(422 + mockDb.invoices.length).padStart(6, '0')}`;
      mockDb.invoices.unshift({
        id: `inv-${Date.now()}`,
        number: nextNum,
        subscription_id: sub.id,
        subscription_number: sub.number,
        customer_id: sub.customer_id,
        customer_name: sub.customer_name,
        status: 'confirmed',
        issue_date: todayIsoDate(),
        due_date: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
        sent_at: new Date().toISOString(),
        currency: sub.currency,
        subtotal: sub.subtotal,
        discount_total: sub.discount_total,
        tax_total: sub.tax_total,
        total: sub.total,
        amount_paid: '0.00',
        balance: sub.total,
        pdf_ready: true,
        lines: sub.lines.map((l) => ({
          id: `il-${Date.now()}-${l.id}`,
          description: `${l.product_name} × ${l.quantity}`,
          quantity: l.quantity,
          unit_price: l.unit_price,
          tax_rate: l.tax_rate,
          tax_inclusive: l.tax_inclusive,
          line_subtotal: l.line_subtotal,
          line_tax: l.line_tax,
          line_total: l.line_total,
        })),
      });
    });

    const summary: BillingRunSummary = {
      id: `run-${Date.now()}`,
      run_date: todayIsoDate(),
      created_count: createdCount,
      skipped_count: pausedSubs.length + Math.max(0, activeSubs.length - createdCount),
      failed_count: 0,
      error_summary: null,
    };
    mockDb.recordAudit(actor, 'BillingRun', summary.id, 'billing_run.executed', null, { ...summary });
    return { status: 200, data: summary };
  }

  // ================= PAYMENTS =================
  if (path === '/payments' && upperMethod === 'GET') {
    const methodFilter = query.get('method') ?? '';
    const search = (query.get('search') ?? '').toLowerCase();
    const fromDate = query.get('from') ?? '';
    const toDate = query.get('to') ?? '';
    const reversalFilter = query.get('reversal') ?? '';

    const filtered = mockDb.payments.filter((p) => {
      if (methodFilter && p.method !== methodFilter) return false;
      if (reversalFilter === 'true' && !p.is_reversal) return false;
      if (reversalFilter === 'false' && p.is_reversal) return false;
      const payDay = p.payment_date.slice(0, 10);
      if (fromDate && payDay < fromDate) return false;
      if (toDate && payDay > toDate) return false;
      if (search) {
        const hay = `${p.invoice_number} ${p.customer_name} ${p.reference} ${p.reversal_reason ?? ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
    if (query.get('format') === 'csv') {
      const csvRows = [
        'Payment Date,Invoice,Customer,Method,Amount,Currency,Reference,Reversal,Reversal Reason,Note',
        ...filtered.map(
          (p) =>
            `"${p.payment_date}","${p.invoice_number}","${p.customer_name}","${p.method}","${p.amount}","${p.currency}","${p.reference}","${p.is_reversal}","${p.reversal_reason ?? ''}","${p.note}"`
        ),
      ].join('\n');
      return { status: 200, blob: new Blob([csvRows], { type: 'text/csv;charset=utf-8;' }) };
    }
    return { status: 200, data: paginate(filtered, query) };
  }

  const payReverseMatch = path.match(/^\/payments\/([^/]+)\/reverse$/);
  if (payReverseMatch && upperMethod === 'POST') {
    const original = mockDb.payments.find((p) => p.id === payReverseMatch[1]);
    if (!original) return err(404, 'NOT_FOUND', 'Payment record not found.');
    if (original.is_reversal || parseMoney(original.amount) <= 0) {
      return err(409, 'CONFLICT', 'Reversal entries cannot be reversed again.');
    }
    const reason = String(payload.reversal_reason ?? '').trim();
    if (!reason) {
      return err(422, 'VALIDATION_ERROR', 'Reversal reason is mandatory for audit compliance.', [
        { field: 'reversal_reason', message: 'Provide a clear reason for reversing this payment.' },
      ]);
    }

    const absAmt = parseMoney(original.amount);
    const reversal: PaymentRecord = {
      id: `pay-rev-${Date.now()}`,
      invoice_id: original.invoice_id,
      invoice_number: original.invoice_number,
      customer_id: original.customer_id,
      customer_name: original.customer_name,
      method: original.method,
      amount: toFixedMoney(-absAmt),
      currency: original.currency,
      payment_date: new Date().toISOString(),
      reference: `REV-${original.reference}`,
      note: `Append-only reversal of ${original.reference}.`,
      is_reversal: true,
      reversal_reason: reason,
    };
    mockDb.payments.unshift(reversal);

    const inv = mockDb.invoices.find((i) => i.id === original.invoice_id);
    if (inv) {
      const nextPaid = Math.max(0, roundHalfUp(parseMoney(inv.amount_paid) - absAmt));
      const nextBal = Math.max(0, roundHalfUp(parseMoney(inv.total) - nextPaid));
      inv.amount_paid = toFixedMoney(nextPaid);
      inv.balance = toFixedMoney(nextBal);
      if (nextBal > 0 && inv.status === 'paid') {
        inv.status = 'confirmed';
      }
    }

    mockDb.recordAudit(actor, 'Payment', reversal.id, 'payment.reversed', { original_payment_id: original.id, amount: original.amount }, { reversal_amount: reversal.amount, reason });
    return { status: 201, data: reversal };
  }

  // ================= REPORTS & FINANCE DASHBOARD =================
  const computeDynamicAgingBuckets = (overdueItems: Invoice[]): AgingBucketSummary[] => {
    const labels: AgingBucketLabel[] = ['0-30 days', '31-60 days', '61-90 days', '90+ days'];
    const map = new Map<AgingBucketLabel, { count: number; amount: number }>(
      labels.map((b) => [b, { count: 0, amount: 0 }])
    );
    overdueItems.forEach((inv) => {
      const age = daysOverdue(inv.due_date);
      const bucket: AgingBucketLabel =
        age <= 30 ? '0-30 days' : age <= 60 ? '31-60 days' : age <= 90 ? '61-90 days' : '90+ days';
      const entry = map.get(bucket)!;
      entry.count += 1;
      entry.amount = roundHalfUp(entry.amount + parseMoney(inv.balance));
    });
    return labels.map((bucket) => {
      const entry = map.get(bucket)!;
      return { bucket, count: entry.count, amount: toFixedMoney(entry.amount) };
    });
  };

  if (path === '/reports/outstanding' && upperMethod === 'GET') {
    const outstandingItems = mockDb.invoices.filter(
      (i) => i.status === 'confirmed' && parseMoney(i.balance) > 0
    );
    const totalOut = outstandingItems.reduce(
      (acc, i) => roundHalfUp(acc + parseMoney(i.balance)),
      0
    );
    const res: OutstandingReportResponse = {
      currency: mockDb.settings.currency,
      total_outstanding: toFixedMoney(totalOut),
      outstanding_count: outstandingItems.length,
      items: outstandingItems,
    };
    return { status: 200, data: res };
  }

  if (path === '/reports/overdue' && upperMethod === 'GET') {
    const overdueItems = mockDb.invoices.filter((i) => isInvoiceOverdue(i));
    const totalOver = overdueItems.reduce(
      (acc, i) => roundHalfUp(acc + parseMoney(i.balance)),
      0
    );
    const res: OverdueReportResponse = {
      currency: mockDb.settings.currency,
      total_overdue: toFixedMoney(totalOver),
      overdue_count: overdueItems.length,
      aging_buckets: computeDynamicAgingBuckets(overdueItems),
      items: overdueItems,
    };
    return { status: 200, data: res };
  }

  if (path === '/reports/summary' && upperMethod === 'GET') {
    const fromDate = query.get('from') ?? '';
    const toDate = query.get('to') ?? '';
    const rangeMonths = Number.parseInt(query.get('months') ?? '6', 10);

    const activeSubs = mockDb.subscriptions.filter((s) => s.status === 'active');
    const pausedSubs = mockDb.subscriptions.filter((s) => s.status === 'paused');
    const mrrNum = activeSubs.reduce((acc, s) => roundHalfUp(acc + normalizeToMonthlyMrr(s.total, s.billing_period)), 0);
    const arrNum = roundHalfUp(mrrNum * 12);

    const nonCancelledInvoices = mockDb.invoices.filter((i) => {
      if (i.status === 'cancelled') return false;
      if (fromDate && i.issue_date < fromDate) return false;
      if (toDate && i.issue_date > toDate) return false;
      return true;
    });
    const totalInvoiced = nonCancelledInvoices.reduce((acc, i) => roundHalfUp(acc + parseMoney(i.total)), 0);

    const allOpenInvoices = mockDb.invoices.filter((i) => i.status !== 'cancelled');
    const outstanding = allOpenInvoices.reduce((acc, i) => roundHalfUp(acc + parseMoney(i.balance)), 0);
    const overdueList = mockDb.invoices.filter((i) => isInvoiceOverdue(i));
    const overdueAmt = overdueList.reduce((acc, i) => roundHalfUp(acc + parseMoney(i.balance)), 0);

    const periodPayments = mockDb.payments.filter((p) => {
      const day = p.payment_date.slice(0, 10);
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      return true;
    });
    const collected = periodPayments.reduce((acc, p) => roundHalfUp(acc + parseMoney(p.amount)), 0);

    const methodMap = new Map<PaymentMethod, { amount: number; count: number }>();
    periodPayments.forEach((p) => {
      const cur = methodMap.get(p.method) ?? { amount: 0, count: 0 };
      cur.amount = roundHalfUp(cur.amount + parseMoney(p.amount));
      cur.count += 1;
      methodMap.set(p.method, cur);
    });

    const monthShortNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const allOpenLedgerInvoices = mockDb.invoices.filter((i) => i.status !== 'cancelled');
    let anchorYm = toDate ? toDate.slice(0, 7) : '';
    if (!anchorYm) {
      for (const inv of allOpenLedgerInvoices) {
        const ym = inv.issue_date.slice(0, 7);
        if (ym > anchorYm) anchorYm = ym;
      }
      for (const pay of mockDb.payments) {
        const ym = pay.payment_date.slice(0, 7);
        if (ym > anchorYm) anchorYm = ym;
      }
      if (!anchorYm) {
        anchorYm = todayIsoDate().slice(0, 7);
      }
    }

    const [anchorYearStr, anchorMonthStr] = anchorYm.split('-');
    const anchorYear = Number.parseInt(anchorYearStr, 10) || 2026;
    const anchorMonthIdx = (Number.parseInt(anchorMonthStr, 10) || 10) - 1;
    const windowSize = rangeMonths === 3 ? 3 : rangeMonths === 12 ? 12 : 6;

    const slicedTrend: Array<{ month: string; invoiced: number; collected: number }> = [];
    for (let offset = windowSize - 1; offset >= 0; offset -= 1) {
      const d = new Date(Date.UTC(anchorYear, anchorMonthIdx - offset, 1));
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const label = `${monthShortNames[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;

      const monthInvoiced = allOpenLedgerInvoices
        .filter((inv) => inv.issue_date.slice(0, 7) === ym)
        .reduce((acc, inv) => roundHalfUp(acc + parseMoney(inv.total)), 0);

      const monthCollected = mockDb.payments
        .filter((pay) => pay.payment_date.slice(0, 7) === ym)
        .reduce((acc, pay) => roundHalfUp(acc + parseMoney(pay.amount)), 0);

      slicedTrend.push({
        month: label,
        invoiced: monthInvoiced,
        collected: Math.max(0, monthCollected),
      });
    }

    const summary: DashboardSummary = {
      currency: mockDb.settings.currency,
      active_subscriptions: activeSubs.length,
      paused_subscriptions: pausedSubs.length,
      mrr: toFixedMoney(mrrNum),
      arr: toFixedMoney(arrNum),
      revenue_collected: toFixedMoney(Math.max(0, collected)),
      total_invoiced: toFixedMoney(totalInvoiced),
      outstanding_amount: toFixedMoney(outstanding),
      overdue_invoice_count: overdueList.length,
      overdue_amount: toFixedMoney(overdueAmt),
      new_subscriptions_count: mockDb.subscriptions.filter((s) => s.status !== 'closed' && s.status !== 'cancelled').length,
      closed_subscriptions_count: mockDb.subscriptions.filter((s) => s.status === 'closed').length,
      payments_by_method: Array.from(methodMap.entries()).map(([m, v]) => ({
        method: m,
        amount: toFixedMoney(Math.max(0, v.amount)),
        count: v.count,
      })),
      revenue_trend: slicedTrend,
      aging_buckets: computeDynamicAgingBuckets(overdueList),
    };
    return { status: 200, data: summary };
  }

  if (path === '/reports/payments' && upperMethod === 'GET') {
    const fromDate = query.get('from') ?? '';
    const toDate = query.get('to') ?? '';
    const filteredPayments = mockDb.payments.filter((p) => {
      const day = p.payment_date.slice(0, 10);
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      return true;
    });
    const methodMap = new Map<PaymentMethod, { amount: number; count: number }>();
    filteredPayments.forEach((p) => {
      const cur = methodMap.get(p.method) ?? { amount: 0, count: 0 };
      cur.amount = roundHalfUp(cur.amount + parseMoney(p.amount));
      cur.count += 1;
      methodMap.set(p.method, cur);
    });
    const totalCol = filteredPayments.reduce((acc, p) => roundHalfUp(acc + parseMoney(p.amount)), 0);
    const res: PaymentsReportResponse = {
      currency: mockDb.settings.currency,
      total_collected: toFixedMoney(Math.max(0, totalCol)),
      by_method: Array.from(methodMap.entries()).map(([m, v]) => ({
        method: m,
        amount: toFixedMoney(Math.max(0, v.amount)),
        count: v.count,
      })),
    };
    return { status: 200, data: res };
  }

  if (path === '/reports/active-subscriptions' && upperMethod === 'GET') {
    const planId = query.get('plan_id') ?? '';
    const customerId = query.get('customer_id') ?? '';
    const statusFilter = query.get('status') ?? 'active';
    const search = (query.get('search') ?? '').toLowerCase();
    const fromDate = query.get('from') ?? '';
    const toDate = query.get('to') ?? '';

    const filteredSubs = mockDb.subscriptions.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (planId && s.plan_id !== planId) return false;
      if (customerId && s.customer_id !== customerId) return false;
      if (fromDate && s.start_date && s.start_date < fromDate) return false;
      if (toDate && s.start_date && s.start_date > toDate) return false;
      if (search) {
        const hay = `${s.number} ${s.customer_name} ${s.plan_name}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    if (query.get('format') === 'csv') {
      const csv = [
        'Number,Customer,Plan,Period,Status,Start Date,Next Billing Date,Total,Currency',
        ...filteredSubs.map(
          (s) =>
            `"${s.number}","${s.customer_name}","${s.plan_name}","${s.billing_period}","${s.status}","${s.start_date ?? ''}","${s.next_billing_date ?? ''}","${s.total}","${s.currency}"`
        ),
      ].join('\n');
      return { status: 200, blob: new Blob([csv], { type: 'text/csv;charset=utf-8;' }) };
    }
    return { status: 200, data: filteredSubs };
  }

  if (path === '/reports/revenue' && upperMethod === 'GET') {
    const planFilter = (query.get('plan_name') ?? '').toLowerCase();
    const search = (query.get('search') ?? '').toLowerCase();
    const fromPeriod = (query.get('from') ?? '').slice(0, 7);
    const toPeriod = (query.get('to') ?? '').slice(0, 7);

    // Dynamically aggregate monthly revenue by plan & primary product from live ledger invoices
    const groupedMap = new Map<
      string,
      { period: string; plan_name: string; product_name: string; invoiced: number; collected: number }
    >();

    for (const inv of mockDb.invoices) {
      if (inv.status === 'cancelled') continue;
      const period = inv.issue_date.slice(0, 7);
      const linkedSub = inv.subscription_id
        ? mockDb.subscriptions.find((s) => s.id === inv.subscription_id)
        : undefined;
      const planName = linkedSub?.plan_name ?? 'Direct Invoice';
      const rawLineDesc = inv.lines[0]?.description ?? 'Subscription Charge';
      const cleanLineDesc = rawLineDesc.split(' (')[0].split(' ×')[0].trim();
      const productName = linkedSub?.lines[0]?.product_name ?? cleanLineDesc;
      const groupKey = `${period}|${planName}|${productName}`;

      const current = groupedMap.get(groupKey) ?? {
        period,
        plan_name: planName,
        product_name: productName,
        invoiced: 0,
        collected: 0,
      };
      current.invoiced = roundHalfUp(current.invoiced + parseMoney(inv.total));
      current.collected = roundHalfUp(current.collected + parseMoney(inv.amount_paid));
      groupedMap.set(groupKey, current);
    }

    const allRows: RevenueReportRow[] = Array.from(groupedMap.values())
      .sort((a, b) => b.period.localeCompare(a.period) || a.plan_name.localeCompare(b.plan_name))
      .map((entry) => ({
        period: entry.period,
        plan_name: entry.plan_name,
        product_name: entry.product_name,
        invoiced: toFixedMoney(entry.invoiced),
        collected: toFixedMoney(Math.max(0, entry.collected)),
        currency: mockDb.settings.currency,
      }));

    const rows = allRows.filter((r) => {
      if (planFilter && r.plan_name.toLowerCase() !== planFilter) return false;
      if (fromPeriod && r.period < fromPeriod) return false;
      if (toPeriod && r.period > toPeriod) return false;
      if (search) {
        const hay = `${r.period} ${r.plan_name} ${r.product_name}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    if (query.get('format') === 'csv') {
      const csv = [
        'Month,Plan,Product,Invoiced,Collected,Currency',
        ...rows.map((r) => `"${r.period}","${r.plan_name}","${r.product_name}","${r.invoiced}","${r.collected}","${r.currency}"`),
      ].join('\n');
      return { status: 200, blob: new Blob([csv], { type: 'text/csv;charset=utf-8;' }) };
    }
    return { status: 200, data: rows };
  }

  // ================= CUSTOMER PORTAL (/me/*) =================
  if (path.startsWith('/me/')) {
    if (!actor || !actor.customer_id) {
      return err(403, 'FORBIDDEN', 'Customer portal isolation requires an authenticated customer session.');
    }
    const custId = actor.customer_id;

    if (path === '/me/subscriptions' && upperMethod === 'GET') {
      return { status: 200, data: mockDb.subscriptions.filter((s) => s.customer_id === custId) };
    }
    if (path === '/me/invoices' && upperMethod === 'GET') {
      return { status: 200, data: mockDb.invoices.filter((i) => i.customer_id === custId) };
    }
    if (path === '/me/payments' && upperMethod === 'GET') {
      return { status: 200, data: mockDb.payments.filter((p) => p.customer_id === custId) };
    }
    if (path === '/me/profile') {
      const cust = mockDb.customers.find((c) => c.id === custId);
      if (!cust) return err(404, 'NOT_FOUND', 'Customer profile not found.');
      if (upperMethod === 'GET') return { status: 200, data: cust };
      if (upperMethod === 'PATCH') {
        if (payload.new_password) {
          const pw = String(payload.new_password);
          if (!evaluatePasswordStrength(pw).isValid) {
            return err(422, 'VALIDATION_ERROR', 'Password does not meet security rules.', [
              { field: 'new_password', message: 'Password must contain 9+ chars, upper, lower, and special char.' },
            ]);
          }
          const userRec = mockDb.users.find((u) => u.id === actor.id);
          if (userRec) userRec.password = pw;
        }
        Object.assign(cust, {
          name: payload.name ?? cust.name,
          phone: payload.phone ?? cust.phone,
          company_name: payload.company_name ?? cust.company_name,
          tax_id: payload.tax_id ?? cust.tax_id,
          billing_address: (payload.billing_address as Customer['billing_address']) ?? cust.billing_address,
        });
        return { status: 200, data: cust };
      }
    }

    const portalConfirmMatch = path.match(/^\/me\/subscriptions\/([^/]+)\/confirm$/);
    if (portalConfirmMatch && upperMethod === 'POST') {
      const sub = mockDb.subscriptions.find(
        (s) => s.id === portalConfirmMatch[1] && s.customer_id === custId
      );
      if (!sub) return err(404, 'NOT_FOUND', 'Subscription not found.');
      if (sub.status !== 'quotation') {
        return err(409, 'CONFLICT', 'Only Quotation subscriptions can be confirmed.');
      }
      if (sub.quote_valid_until && todayIsoDate() > sub.quote_valid_until) {
        return err(409, 'CONFLICT', `Quotation expired on ${sub.quote_valid_until}.`);
      }
      sub.status = 'confirmed';
      sub.activities.unshift({
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor_email: actor.email,
        action: 'Customer Confirmed Order',
        note: 'Quotation accepted via Customer Self-Service Portal.',
      });
      return { status: 200, data: sub };
    }

    const portalInvPdfMatch = path.match(/^\/me\/invoices\/([^/]+)\/pdf$/);
    if (portalInvPdfMatch && upperMethod === 'GET') {
      const inv = mockDb.invoices.find(
        (i) => i.id === portalInvPdfMatch[1] && i.customer_id === custId
      );
      if (!inv) return err(404, 'NOT_FOUND', 'Invoice not found.');
      return { status: 200, blob: generateInvoicePdfBlob(inv) };
    }

    const portalReqMatch = path.match(/^\/me\/subscriptions\/([^/]+)\/request$/);
    if (portalReqMatch && upperMethod === 'POST') {
      const sub = mockDb.subscriptions.find((s) => s.id === portalReqMatch[1] && s.customer_id === custId);
      if (!sub) return err(404, 'NOT_FOUND', 'Subscription not found.');
      const reqType = String(payload.request_type ?? 'upgrade');
      const note = String(payload.note ?? '');
      mockDb.notifications.unshift({
        id: `notif-${Date.now()}`,
        created_at: new Date().toISOString(),
        title: `Portal ${reqType.toUpperCase()} Request — ${sub.number}`,
        message: `${sub.customer_name} requested ${reqType}: ${note || 'No additional note.'}`,
        type: 'info',
        read: false,
      });
      sub.activities.unshift({
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor_email: actor.email,
        action: `Portal Request (${reqType})`,
        note: note || `Customer submitted ${reqType} request.`,
      });
      return { status: 200, data: { message: `Your ${reqType} request has been logged for our billing team.`, subscription: sub } };
    }

    const portalPayMatch = path.match(/^\/me\/invoices\/([^/]+)\/pay$/);
    if (portalPayMatch && upperMethod === 'POST') {
      const inv = mockDb.invoices.find((i) => i.id === portalPayMatch[1] && i.customer_id === custId);
      if (!inv) return err(404, 'NOT_FOUND', 'Invoice not found.');
      const payAmt = parseMoney(String(payload.amount ?? inv.balance));
      if (payAmt <= 0 || payAmt > parseMoney(inv.balance) + 0.001) {
        return err(422, 'VALIDATION_ERROR', 'Invalid payment amount.');
      }
      const payment: PaymentRecord = {
        id: `pay-${Date.now()}`,
        invoice_id: inv.id,
        invoice_number: inv.number,
        customer_id: custId,
        customer_name: inv.customer_name,
        method: (payload.method as PaymentMethod) ?? 'card',
        amount: toFixedMoney(payAmt),
        currency: inv.currency,
        payment_date: new Date().toISOString(),
        reference: `SANDBOX-${Date.now().toString().slice(-6)}`,
        note: 'Online Customer Portal Checkout (Sandbox)',
        is_reversal: false,
      };
      mockDb.payments.unshift(payment);
      const newPaid = roundHalfUp(parseMoney(inv.amount_paid) + payAmt);
      const newBal = Math.max(0, roundHalfUp(parseMoney(inv.total) - newPaid));
      inv.amount_paid = toFixedMoney(newPaid);
      inv.balance = toFixedMoney(newBal);
      if (newBal === 0) inv.status = 'paid';
      return { status: 200, data: { payment, invoice: inv } };
    }
  }

  return err(404, 'NOT_FOUND', `Endpoint ${upperMethod} ${path} not found.`);
}
