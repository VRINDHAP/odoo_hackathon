/* ==========================================================================
   Live FastAPI Backend Contract Adapter (/api/v1)
   Bridges schema & route differences between INTERFACES.md and the mounted
   FastAPI + PostgreSQL routers without requiring backend modifications.
   ========================================================================== */

import type {
  AuditLogEntry,
  AuthUser,
  PaginatedResponse,
  Subscription,
  SubscriptionLine,
  UserRole,
} from '../types/domain';
import { toFixedMoney } from '../utils/money';
import { tokenStore } from './tokenStore';

export interface RewrittenLiveRequest {
  livePath: string;
  body: unknown;
  originalCleanPath: string;
  originalQuery: URLSearchParams;
}

function clampPaginationParams(query: URLSearchParams): URLSearchParams {
  const cloned = new URLSearchParams(query.toString());
  const rawSize = cloned.get('page_size');
  if (rawSize) {
    const parsed = Number.parseInt(rawSize, 10);
    if (!Number.isNaN(parsed) && parsed > 100) {
      cloned.set('page_size', '100');
    }
  }
  return cloned;
}

export function rewriteLiveRequest(
  method: string,
  normalizedPath: string,
  body: unknown
): RewrittenLiveRequest {
  const upperMethod = method.toUpperCase();
  const [cleanPath, rawSearch = ''] = normalizedPath.split('?');
  const originalQuery = new URLSearchParams(rawSearch);
  const query = clampPaginationParams(originalQuery);

  let targetPath = cleanPath;
  let nextBody = body;

  // 1. Auth refresh & logout require { refresh_token } in JSON body on live FastAPI
  if ((cleanPath === '/auth/refresh' || cleanPath === '/auth/logout') && upperMethod === 'POST') {
    const refreshToken = tokenStore.getRefreshToken();
    if (refreshToken && (!body || typeof body !== 'object')) {
      nextBody = { refresh_token: refreshToken };
    }
  }

  // 2. Audit logs mounted at /audit_logs on live FastAPI
  if (cleanPath === '/audit-logs' && upperMethod === 'GET') {
    targetPath = '/audit_logs';
  }

  // 3. Staff listing & updates mounted at GET /users & PATCH /users/{id} on live FastAPI
  if (cleanPath === '/users/staff' && upperMethod === 'GET') {
    targetPath = '/users';
  }
  const staffPatchMatch = cleanPath.match(/^\/users\/staff\/([^/]+)$/);
  if (staffPatchMatch && upperMethod === 'PATCH') {
    targetPath = `/users/${staffPatchMatch[1]}`;
  }

  // 4. Staff creation requires `password` field on live FastAPI StaffCreateRequest
  if (cleanPath === '/users/staff' && upperMethod === 'POST' && body && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    if (!rec.password) {
      nextBody = {
        ...rec,
        password: 'StaffTemp#2026',
      };
    }
  }

  // 5. Payments list date filter query keys (`from`/`to` -> `start_date`/`end_date`)
  if (cleanPath === '/payments' && upperMethod === 'GET') {
    if (query.has('from') && !query.has('start_date')) {
      query.set('start_date', query.get('from') ?? '');
    }
    if (query.has('to') && !query.has('end_date')) {
      query.set('end_date', query.get('to') ?? '');
    }
  }

  // 6. Payment reversal expects `{ reason, note }` on live FastAPI PaymentReversalCreate
  if (/^\/payments\/[^/]+\/reverse$/.test(cleanPath) && upperMethod === 'POST' && body && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    const reasonText = String(rec.reason ?? rec.reversal_reason ?? '').trim();
    nextBody = {
      ...rec,
      reason: reasonText,
      reversal_reason: reasonText,
    };
  }

  const qs = query.toString();
  return {
    livePath: qs ? `${targetPath}?${qs}` : targetPath,
    body: nextBody,
    originalCleanPath: cleanPath,
    originalQuery,
  };
}

function toPaginatedEnvelope<T>(
  items: T[],
  headers: Headers,
  query: URLSearchParams
): PaginatedResponse<T> {
  const page = Math.max(1, Number.parseInt(query.get('page') ?? '1', 10) || 1);
  const pageSize = Math.max(1, Number.parseInt(query.get('page_size') ?? '25', 10) || 25);
  const headerTotal = Number.parseInt(headers.get('X-Total-Count') ?? '', 10);
  const total = Number.isNaN(headerTotal) ? items.length : headerTotal;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items,
    page,
    page_size: pageSize,
    total,
    total_pages: totalPages,
  };
}

function normalizeSubscriptionRecord(raw: Record<string, unknown>): Subscription {
  const rawLines = Array.isArray(raw.lines) ? (raw.lines as Array<Record<string, unknown>>) : [];
  const lines: SubscriptionLine[] = rawLines.map((ln, idx) => ({
    id: String(ln.id ?? `line-${idx}`),
    product_id: String(ln.product_id ?? ''),
    product_name: String(ln.product_name ?? ln.description ?? 'Catalog Item'),
    variant_id: (ln.variant_id as string | null) ?? null,
    variant_label: (ln.variant_label as string | null) ?? null,
    quantity: Number(ln.quantity ?? 1),
    unit_price: toFixedMoney(Number(ln.unit_price ?? 0)),
    tax_rate: toFixedMoney(Number(ln.tax_rate ?? 0)),
    tax_inclusive: Boolean(ln.tax_inclusive ?? false),
    line_subtotal: toFixedMoney(Number(ln.line_subtotal ?? ln.subtotal ?? 0)),
    line_tax: toFixedMoney(Number(ln.line_tax ?? ln.tax_amount ?? 0)),
    line_total: toFixedMoney(Number(ln.line_total ?? ln.total ?? 0)),
  }));

  return {
    id: String(raw.id ?? ''),
    number: String(raw.number ?? ''),
    customer_id: String(raw.customer_id ?? ''),
    customer_name: String(raw.customer_name ?? raw.customer_id ?? 'Customer'),
    plan_id: String(raw.plan_id ?? ''),
    plan_name: String(raw.plan_name ?? raw.plan_id ?? 'Plan'),
    billing_period: (raw.billing_period as Subscription['billing_period']) ?? 'monthly',
    status: (raw.status as Subscription['status']) ?? 'draft',
    payment_terms: (raw.payment_terms as Subscription['payment_terms']) ?? 'Net 15',
    anchor_day: Number(raw.anchor_day ?? 1),
    start_date: (raw.start_date as string | null) ?? null,
    expiry_date: ((raw.expiry_date ?? raw.end_date) as string | null) ?? null,
    next_billing_date: (raw.next_billing_date as string | null) ?? null,
    last_billed_through: (raw.last_billed_through as string | null) ?? null,
    quote_valid_until: ((raw.quote_valid_until ?? raw.quotation_expires_at) as string | null) ?? null,
    paused_at: (raw.paused_at as string | null) ?? null,
    closed_at: (raw.closed_at as string | null) ?? null,
    close_reason: (raw.close_reason as string | null) ?? null,
    coupon_code: (raw.coupon_code as string | null) ?? null,
    discount_name: (raw.discount_name as string | null) ?? null,
    currency: String(raw.currency ?? 'INR'),
    subtotal: toFixedMoney(Number(raw.subtotal ?? 0)),
    discount_total: toFixedMoney(Number(raw.discount_total ?? raw.discount_amount ?? 0)),
    tax_total: toFixedMoney(Number(raw.tax_total ?? raw.tax_amount ?? 0)),
    total: toFixedMoney(Number(raw.total ?? raw.total_amount ?? 0)),
    lines,
    activities: Array.isArray(raw.activities)
      ? (raw.activities as Subscription['activities'])
      : [],
  };
}

export function normalizeLiveResponse<T>(
  method: string,
  originalCleanPath: string,
  originalQuery: URLSearchParams,
  data: unknown,
  headers: Headers
): T {
  const upperMethod = method.toUpperCase();

  // 1. Audit log list normalization: FastAPI AuditLogResponse[] -> PaginatedResponse<AuditLogEntry>
  if (originalCleanPath === '/audit-logs' && upperMethod === 'GET') {
    if (Array.isArray(data)) {
      const mapped: AuditLogEntry[] = data.map((row: Record<string, unknown>) => ({
        id: String(row.id ?? ''),
        timestamp: String(row.timestamp ?? row.at ?? new Date().toISOString()),
        actor_id: String(row.actor_id ?? 'system'),
        actor_email: String(row.actor_email ?? row.actor_id ?? 'system@brightloop.io'),
        actor_role: ((row.actor_role as UserRole) ?? 'admin'),
        entity: String(row.entity ?? ''),
        entity_id: String(row.entity_id ?? ''),
        action: String(row.action ?? ''),
        ip_address: String(row.ip_address ?? row.ip ?? '127.0.0.1'),
        before: ((row.before ?? row.before_json) as Record<string, unknown> | null) ?? null,
        after: ((row.after ?? row.after_json) as Record<string, unknown> | null) ?? null,
      }));
      return toPaginatedEnvelope(mapped, headers, originalQuery) as unknown as T;
    }
  }

  // 2. Staff list normalization: filter internal roles (admin | staff)
  if (originalCleanPath === '/users/staff' && upperMethod === 'GET' && Array.isArray(data)) {
    const staffOnly = (data as AuthUser[]).filter(
      (u) => u.role === 'admin' || u.role === 'staff'
    );
    return staffOnly as unknown as T;
  }

  // 3. Subscriptions list & detail normalization
  if (originalCleanPath === '/subscriptions' && upperMethod === 'GET') {
    if (Array.isArray(data)) {
      const normalized = data.map((item) =>
        normalizeSubscriptionRecord(item as Record<string, unknown>)
      );
      return toPaginatedEnvelope(normalized, headers, originalQuery) as unknown as T;
    }
    if (data && typeof data === 'object' && 'items' in data && Array.isArray((data as { items: unknown[] }).items)) {
      const env = data as PaginatedResponse<Record<string, unknown>>;
      return {
        ...env,
        items: env.items.map(normalizeSubscriptionRecord),
      } as unknown as T;
    }
  }

  if (
    /^\/subscriptions\/[^/]+(\/.*)?$/.test(originalCleanPath) &&
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    'number' in data &&
    'plan_id' in data
  ) {
    return normalizeSubscriptionRecord(data as Record<string, unknown>) as unknown as T;
  }

  if (originalCleanPath === '/me/subscriptions' && upperMethod === 'GET' && Array.isArray(data)) {
    return data.map((item) =>
      normalizeSubscriptionRecord(item as Record<string, unknown>)
    ) as unknown as T;
  }

  // 4. Paginated list endpoints where live FastAPI may return raw Array + X-Total-Count
  if (
    (originalCleanPath === '/customers' ||
      originalCleanPath === '/invoices' ||
      originalCleanPath === '/payments') &&
    upperMethod === 'GET' &&
    Array.isArray(data)
  ) {
    return toPaginatedEnvelope(data, headers, originalQuery) as unknown as T;
  }

  // 5. Payment creation endpoint normalization ({ payment, invoice } vs PaymentResponse)
  if (
    (/^\/invoices\/[^/]+\/payments$/.test(originalCleanPath) ||
      /^\/me\/invoices\/[^/]+\/pay$/.test(originalCleanPath)) &&
    upperMethod === 'POST' &&
    data &&
    typeof data === 'object' &&
    !('payment' in data) &&
    'invoice_id' in data
  ) {
    return {
      payment: data,
      invoice: null,
    } as unknown as T;
  }

  return data as T;
}

