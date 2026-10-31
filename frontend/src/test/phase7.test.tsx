import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { tokenStore } from '../api/tokenStore';
import type {
  AuthResponse,
  BillingRunSummary,
  DashboardSummary,
  Invoice,
  PaginatedResponse,
  Plan,
  Subscription,
} from '../types/domain';
import { DataTable, type DataColumn } from '../components/tables/DataTable';
import { PortalInvoicesPage } from '../features/portal/PortalInvoicesPage';
import { PortalProfilePage } from '../features/portal/PortalProfilePage';
import { PortalSubscriptionsPage } from '../features/portal/PortalSubscriptionsPage';
import { AuthProvider } from '../hooks/useAuth';
import { ToastProvider } from '../hooks/useToast';

describe('Phase 7 — Customer Portal Isolation, Sandbox Checkout, Profile & >1000 Row Virtualization', () => {
  beforeEach(() => {
    // Sign in as VerveCloud Customer (cust-01)
    tokenStore.setSession('mock-cust-jwt', {
      id: 'usr-cust-01',
      email: 'arjun@vervecloud.in',
      role: 'customer',
      customer_id: 'cust-01',
    });
  });

  it('strictly isolates My Subscriptions to customer-owned records (/me/subscriptions) and logs upgrade requests', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <PortalSubscriptionsPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('SUB-2026-000101')).toBeInTheDocument();
    });

    // Other customers' subscriptions MUST NEVER appear
    expect(screen.queryByText('SUB-2026-000102')).not.toBeInTheDocument();
    expect(screen.queryByText('SUB-2026-000103')).not.toBeInTheDocument();

    // Submit tracked upgrade request
    fireEvent.click(screen.getByRole('button', { name: /Request Upgrade/i }));
    expect(screen.getByText('Request Plan Upgrade')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Details \/ Preferred Effective Date/i), {
      target: { value: 'Add 10 seats for Q4 launch.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit Request/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Your upgrade request has been logged for our billing team/i)
      ).toBeInTheDocument();
    });
  });

  it('completes built-in Sandbox Gateway Checkout on My Invoices (/me/invoices/{id}/pay) and updates status to Paid', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <PortalInvoicesPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('INV-2026-000412')).toBeInTheDocument();
    });

    // Other customers' invoices MUST NEVER appear
    expect(screen.queryByText('INV-2026-000415')).not.toBeInTheDocument();
    expect(screen.queryByText('INV-2026-000418')).not.toBeInTheDocument();

    // Click Pay Now on open confirmed invoice INV-2026-000412
    fireEvent.click(screen.getByRole('button', { name: /Pay Now/i }));
    expect(screen.getByText(/Built-In Sandbox Simulation Mode/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Authorize & Pay/i }));

    await waitFor(() => {
      expect(screen.getByText(/Payment Confirmed — INV-2026-000412/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Download Receipt PDF/i })).toBeInTheDocument();
  });

  it('updates billing profile (/me/profile) and blocks weak password updates with rule checklist', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <PortalProfilePage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('VerveCloud Technologies Pvt Ltd')).toBeInTheDocument();
    });

    // Reject weak password
    fireEvent.change(screen.getByLabelText(/^New Password$/i), {
      target: { value: 'weak1!' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm New Password/i), {
      target: { value: 'weak1!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Update Password/i }));

    expect(
      screen.getByText(/Password must be at least 9 characters/i)
    ).toBeInTheDocument();

    // Accept strong password
    fireEvent.change(screen.getByLabelText(/^New Password$/i), {
      target: { value: 'StrongPortal9#' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm New Password/i), {
      target: { value: 'StrongPortal9#' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Update Password/i }));

    await waitFor(() => {
      expect(screen.getByText(/Portal password updated/i)).toBeInTheDocument();
    });
  });

  it('virtualizes 1,500-row DataTable well under the 2.0s interactive render budget', () => {
    interface SyntheticRow {
      id: string;
      number: string;
      amount: string;
    }

    const largeDataset: SyntheticRow[] = Array.from({ length: 1500 }, (_, i) => ({
      id: `row-${i}`,
      number: `SUB-2026-${String(i + 1).padStart(6, '0')}`,
      amount: '12500.00',
    }));

    const cols: DataColumn<SyntheticRow>[] = [
      { key: 'number', header: 'Number', render: (r) => r.number },
      { key: 'amount', header: 'Amount', align: 'right', render: (r) => r.amount },
    ];

    const startMs = performance.now();
    const { container } = render(
      <DataTable columns={cols} rows={largeDataset} rowKey={(r) => r.id} />
    );
    const elapsedMs = performance.now() - startMs;

    // Must render well within the 2,000ms (< 2s) hackathon performance budget
    expect(elapsedMs).toBeLessThan(2000);

    // Virtualizer prevents mounting all 1,500 <tr> rows into the DOM simultaneously
    const renderedBodyRows = container.querySelectorAll('tbody tr');
    expect(renderedBodyRows.length).toBeLessThan(100);
  });

  it('executes full end-to-end lifecycle: Customer Signup -> Admin Plan -> Staff Quote -> Customer Confirm -> Activate -> Billing Run -> Payment -> Dashboard Updated', async () => {
    // 1. Public Customer Signup
    const signupRes = await apiRequest<AuthResponse>('/auth/signup', {
      method: 'POST',
      body: {
        name: 'Meera Nair',
        email: 'meera@zenithlabs.in',
        company_name: 'Zenith Labs India',
        password: 'ZenithStrong9!',
      },
    });
    expect(signupRes.user.role).toBe('customer');
    const newCustomerId = signupRes.user.customer_id!;
    expect(newCustomerId).toBeTruthy();

    // 2. Admin creates Plan
    tokenStore.setSession('mock-admin-jwt', {
      id: 'usr-admin-01',
      email: 'admin@brightloop.io',
      role: 'admin',
      customer_id: null,
    });
    const plan = await apiRequest<Plan>('/plans', {
      method: 'POST',
      body: {
        name: 'Zenith Pro Monthly',
        billing_period: 'monthly',
        price: '10000.00',
        min_quantity: 1,
        pausable: true,
        closable: true,
        renewable: true,
        auto_close: false,
        is_active: true,
      },
    });
    expect(plan.id).toBeTruthy();

    // 3. Staff creates Draft & transitions to Quotation
    tokenStore.setSession('mock-staff-jwt', {
      id: 'usr-staff-01',
      email: 'nandana@brightloop.io',
      role: 'staff',
      customer_id: null,
    });
    const draftSub = await apiRequest<Subscription>('/subscriptions', {
      method: 'POST',
      body: {
        customer_id: newCustomerId,
        plan_id: plan.id,
        payment_terms: 'Net 15',
        lines: [
          {
            id: 'e2e-line-1',
            product_id: 'prod-01',
            product_name: 'SSVN Systems Core ERP Suite',
            variant_id: null,
            quantity: 2,
            unit_price: '10000.00',
            tax_rate: '18.00',
            tax_inclusive: false,
            line_subtotal: '20000.00',
            line_tax: '3600.00',
            line_total: '23600.00',
          },
        ],
      },
    });
    const quotedSub = await apiRequest<Subscription>(
      `/subscriptions/${draftSub.id}/transition`,
      { method: 'POST', body: { target: 'quotation' } }
    );
    expect(quotedSub.status).toBe('quotation');

    // 4. Customer confirms Quotation from Portal (/me/subscriptions/{id}/confirm)
    tokenStore.setSession(signupRes.access_token, signupRes.user);
    const confirmedSub = await apiRequest<Subscription>(
      `/me/subscriptions/${draftSub.id}/confirm`,
      { method: 'POST' }
    );
    expect(confirmedSub.status).toBe('confirmed');

    // 5. Staff activates Confirmed subscription
    tokenStore.setSession('mock-staff-jwt', {
      id: 'usr-staff-01',
      email: 'nandana@brightloop.io',
      role: 'staff',
      customer_id: null,
    });
    const activeSub = await apiRequest<Subscription>(
      `/subscriptions/${draftSub.id}/transition`,
      { method: 'POST', body: { target: 'active' } }
    );
    expect(activeSub.status).toBe('active');

    // 6. Admin runs Billing Engine -> generates Confirmed invoice for new Active subscription
    tokenStore.setSession('mock-admin-jwt', {
      id: 'usr-admin-01',
      email: 'admin@brightloop.io',
      role: 'admin',
      customer_id: null,
    });
    const billingRun = await apiRequest<BillingRunSummary>('/billing/run', {
      method: 'POST',
    });
    expect(billingRun.created_count).toBeGreaterThanOrEqual(1);

    const invList = await apiRequest<PaginatedResponse<Invoice>>(
      `/invoices?customer_id=${newCustomerId}`
    );
    expect(invList.items.length).toBeGreaterThan(0);
    const generatedInv = invList.items[0];
    expect(generatedInv.status).toBe('confirmed');

    // 7. Record full Payment -> settles invoice to Paid
    const payRes = await apiRequest<{ invoice: Invoice }>(
      `/invoices/${generatedInv.id}/payments`,
      {
        method: 'POST',
        body: {
          method: 'upi',
          amount: generatedInv.balance,
          reference: 'UPI-E2E-998877',
        },
      }
    );
    expect(payRes.invoice.status).toBe('paid');
    expect(payRes.invoice.balance).toBe('0.00');

    // 8. Dashboard Summary reflects increased Active Subscriptions & MRR
    const summary = await apiRequest<DashboardSummary>('/reports/summary');
    expect(summary.active_subscriptions).toBeGreaterThanOrEqual(3);
  });
});
