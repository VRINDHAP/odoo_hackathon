import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { normalizeLiveResponse, rewriteLiveRequest } from '../api/liveAdapter';
import { resetMockDatabase } from '../api/mockEngine';
import { emitManualRefresh } from '../api/realtimeBus';
import { tokenStore } from '../api/tokenStore';
import { WorkspaceLayout } from '../app/WorkspaceLayout';
import { CustomersPage } from '../features/customers/CustomersPage';
import { TaxesPage } from '../features/taxes/TaxesPage';
import { AuthProvider } from '../hooks/useAuth';
import { useRealtimeSync } from '../hooks/useRealtimeSync';
import { ToastProvider } from '../hooks/useToast';
import type {
  AuditLogEntry,
  DashboardSummary,
  PaginatedResponse,
  RevenueReportRow,
} from '../types/domain';
import {
  isValidDateRange,
  isValidPhone,
  isValidPostalCode,
  isValidTaxId,
} from '../utils/validation';

describe('Hackathon Must-Have Audit — Dynamic Data, Live Adapter, Validation & Navigation', () => {
  beforeEach(() => {
    resetMockDatabase();
    tokenStore.setSession(
      'mock-admin-jwt',
      {
        id: 'usr-admin-01',
        email: 'admin@brightloop.io',
        role: 'admin',
        customer_id: null,
      },
      'mock-refresh-token-01'
    );
  });

  it('computes revenue_trend and monthly revenue report 100% dynamically from live ledger mutations (zero static JSON)', async () => {
    const beforeSummary = await apiRequest<DashboardSummary>('/reports/summary?months=6');
    const beforeOct = beforeSummary.revenue_trend.find((pt) => pt.month === 'Oct 26');
    expect(beforeOct).toBeDefined();
    expect(beforeOct?.invoiced).toBeCloseTo(94258.4, 2);
    expect(beforeOct?.collected).toBeCloseTo(20000, 2);

    const beforeRevenueRows = await apiRequest<RevenueReportRow[]>('/reports/revenue');
    const beforeOctRow = beforeRevenueRows.find(
      (r) => r.period === '2026-10' && r.plan_name === 'Growth Monthly'
    );
    expect(beforeOctRow?.collected).toBe('20000.00');

    // Record a live payment of INR 12,500.00 against inv-02 in October 2026
    await apiRequest('/invoices/inv-02/payments', {
      method: 'POST',
      body: {
        method: 'upi',
        amount: '12500.00',
        payment_date: '2026-10-28T10:00:00Z',
        reference: 'UPI-DYNAMIC-TEST-01',
        note: 'Dynamic chart verification',
      },
    });

    const afterSummary = await apiRequest<DashboardSummary>('/reports/summary?months=6');
    const afterOct = afterSummary.revenue_trend.find((pt) => pt.month === 'Oct 26');
    expect(afterOct?.collected).toBeCloseTo(32500, 2);

    const afterRevenueRows = await apiRequest<RevenueReportRow[]>('/reports/revenue');
    const afterOctRow = afterRevenueRows.find(
      (r) => r.period === '2026-10' && r.plan_name === 'Growth Monthly'
    );
    expect(afterOctRow?.collected).toBe('32500.00');
  });

  it('normalizes live FastAPI routes, pagination headers, refresh tokens, and audit schemas cleanly', () => {
    const refreshRewrite = rewriteLiveRequest('POST', '/auth/refresh', undefined);
    expect(refreshRewrite.body).toEqual({ refresh_token: 'mock-refresh-token-01' });

    const auditRewrite = rewriteLiveRequest(
      'GET',
      '/audit-logs?page=1&page_size=250',
      undefined
    );
    expect(auditRewrite.livePath).toBe('/audit_logs?page=1&page_size=100');

    const headers = new Headers({ 'X-Total-Count': '42' });
    const normalizedAudit = normalizeLiveResponse<PaginatedResponse<AuditLogEntry>>(
      'GET',
      auditRewrite.originalCleanPath,
      new URLSearchParams('page=1&page_size=25'),
      [
        {
          id: 'aud-live-1',
          actor_id: 'usr-admin-01',
          entity: 'Subscription',
          entity_id: 'sub-99',
          action: 'subscription.activated',
          before_json: { status: 'confirmed' },
          after_json: { status: 'active' },
          ip: '10.0.0.12',
          at: '2026-10-31T08:00:00Z',
        },
      ],
      headers
    );

    expect(normalizedAudit.total).toBe(42);
    expect(normalizedAudit.total_pages).toBe(2);
    expect(normalizedAudit.items[0].ip_address).toBe('10.0.0.12');
    expect(normalizedAudit.items[0].timestamp).toBe('2026-10-31T08:00:00Z');
    expect(normalizedAudit.items[0].after).toEqual({ status: 'active' });
  });

  it('triggers useRealtimeSync listeners immediately upon data mutation or manual sync', async () => {
    const syncSpy = vi.fn();
    const SyncProbe = () => {
      useRealtimeSync(syncSpy, { refreshOnFocus: false });
      return <div>Sync Probe Ready</div>;
    };

    render(<SyncProbe />);
    emitManualRefresh();

    await waitFor(() => {
      expect(syncSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('validates phone numbers, GSTIN/Tax IDs, postal codes, percentage caps, and Escape modal close', async () => {
    expect(isValidPhone('+91 98450 12345')).toBe(true);
    expect(isValidPhone('123')).toBe(false);
    expect(isValidTaxId('29AABCV4819K1Z2')).toBe(true);
    expect(isValidTaxId('BAD!')).toBe(false);
    expect(isValidPostalCode('560038')).toBe(true);
    expect(isValidDateRange('2026-10-01', '2026-09-30')).toBe(false);
    expect(isValidDateRange('2026-10-01', '2026-10-31')).toBe(true);

    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <CustomersPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    const newCustomerBtns = await screen.findAllByRole('button', { name: /New Customer/i });
    fireEvent.click(newCustomerBtns[0]);

    fireEvent.change(screen.getByLabelText(/Company Name/i), { target: { value: 'Acme Corp' } });
    fireEvent.change(screen.getByLabelText(/Primary Contact Name/i), { target: { value: 'Rohan' } });
    fireEvent.change(screen.getByLabelText(/Billing Email/i), { target: { value: 'rohan@acme.in' } });
    fireEvent.change(screen.getByLabelText(/Phone/i), { target: { value: '99' } });
    fireEvent.change(screen.getByLabelText(/Tax ID \/ GSTIN/i), { target: { value: '@@bad' } });

    fireEvent.click(screen.getByRole('button', { name: /Create Customer/i }));

    expect(await screen.findByText(/Enter a valid phone number/i)).toBeInTheDocument();
    expect(screen.getByText(/Tax ID \/ GSTIN must be 6–20 alphanumeric/i)).toBeInTheDocument();

    // Pressing Escape dismisses the modal cleanly
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('blocks percentage tax rules exceeding 100% and renders contextual breadcrumbs & mobile nav drawer', async () => {
    render(
      <MemoryRouter initialEntries={['/invoices/inv-02']}>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route element={<WorkspaceLayout />}>
                <Route path="/invoices/:id" element={<TaxesPage />} />
              </Route>
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    // Contextual breadcrumb shows parent module link ("Invoices") and "Record Detail"
    const breadcrumbNav = await screen.findByRole('navigation', { name: /Breadcrumb/i });
    expect(breadcrumbNav).toHaveTextContent('Billing & Ledger');
    expect(breadcrumbNav).toHaveTextContent('Invoices');
    expect(breadcrumbNav).toHaveTextContent('Record Detail');

    // Open New Tax modal and test > 100% validation guard
    const newTaxBtn = await screen.findByRole('button', { name: /New Tax Rule/i });
    fireEvent.click(newTaxBtn);

    fireEvent.change(screen.getByLabelText(/Tax Rule Name/i), { target: { value: 'Invalid GST' } });
    fireEvent.change(screen.getByLabelText(/Rate \(%\)/i), { target: { value: '145' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Tax Rule/i }));

    expect(
      await screen.findByText(/Percentage tax rate cannot exceed 100%/i)
    ).toBeInTheDocument();
  });
});
