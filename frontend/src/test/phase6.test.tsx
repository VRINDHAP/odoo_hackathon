import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { tokenStore } from '../api/tokenStore';
import { DashboardPage } from '../features/reports/DashboardPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { AuthProvider } from '../hooks/useAuth';
import { ToastProvider } from '../hooks/useToast';

describe('Phase 6 — Executive Finance Dashboard, Interactive Charts & CSV Reports', () => {
  beforeEach(() => {
    tokenStore.setSession('mock-admin-jwt', {
      id: 'usr-admin-01',
      email: 'admin@brightloop.io',
      role: 'admin',
      customer_id: null,
    });
  });

  it('renders normalized MRR, ARR, and all executive currency KPIs for Admin (Paused excluded)', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <DashboardPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('kpi-mrr')).toBeInTheDocument();
    });

    // sub-01 (62,988.40 monthly) + sub-02 (566,400.00 / 12 = 47,200.00 yearly) = 110,188.40 MRR (sub-03 paused excluded)
    expect(screen.getByTestId('kpi-mrr')).toHaveTextContent('INR 1,10,188.40');
    expect(screen.getByTestId('kpi-arr')).toHaveTextContent('INR 13,22,260.80');
    expect(screen.getByRole('button', { name: /Run Billing Now/i })).toBeInTheDocument();
  });

  it('hides executive MRR/ARR and Run Billing Now from Internal Staff operational view', async () => {
    tokenStore.setSession('mock-staff-jwt', {
      id: 'usr-staff-01',
      email: 'nandana@brightloop.io',
      role: 'staff',
      customer_id: null,
    });

    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <DashboardPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Operational Staff View/i)).toBeInTheDocument();
    });

    expect(screen.queryByTestId('kpi-mrr')).not.toBeInTheDocument();
    expect(screen.queryByTestId('kpi-arr')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Run Billing Now/i })).not.toBeInTheDocument();
  });

  it('reveals exact tooltip figures on chart hover and updates trend horizon filter', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <DashboardPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('trend-point-5')).toBeInTheDocument();
    });

    // Hover October data point on RevenueTrendChart
    fireEvent.mouseEnter(screen.getByTestId('trend-point-5'));

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Oct 26');
    // Dynamically summed from live Oct 2026 ledger: inv-02 (62,988.40) + inv-05 (31,270.00) = 94,258.40; pay-02 = 20,000.00
    expect(tooltip).toHaveTextContent('INR 94,258.40');
    expect(tooltip).toHaveTextContent('INR 20,000.00');

    // Switch horizon filter to Last 3 Months -> slices trend to 3 points
    fireEvent.change(screen.getByLabelText(/Trend horizon/i), { target: { value: '3' } });

    await waitFor(() => {
      expect(screen.queryByTestId('trend-point-5')).not.toBeInTheDocument();
      expect(screen.getByTestId('trend-point-2')).toBeInTheDocument();
    });
  });

  it('renders Active Subscriptions & Revenue report tables and exports valid CSV blobs', async () => {
    const createObjectUrlSpy = vi.fn(() => 'blob:mock-report-csv');
    const revokeObjectUrlSpy = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectUrlSpy,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectUrlSpy,
    });
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <ReportsPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('SUB-2026-000101')).toBeInTheDocument();
    });

    // Export Active Subscriptions CSV
    fireEvent.click(screen.getByRole('button', { name: /Export Subscriptions CSV/i }));
    await waitFor(() => {
      expect(screen.getByText(/Active subscriptions CSV downloaded/i)).toBeInTheDocument();
    });
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);

    // Switch to Monthly Revenue tab & export CSV
    fireEvent.click(screen.getByRole('button', { name: /Monthly Revenue by Plan/i }));
    await waitFor(() => {
      expect(screen.getByText('2026-10')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Export Revenue CSV/i }));
    await waitFor(() => {
      expect(screen.getByText(/Monthly revenue CSV downloaded/i)).toBeInTheDocument();
    });
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(2);

    anchorClickSpy.mockRestore();
  });
});

