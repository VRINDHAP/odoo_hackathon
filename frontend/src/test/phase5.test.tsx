import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { tokenStore } from '../api/tokenStore';
import { OverdueAgingPage } from '../features/payments/OverdueAgingPage';
import { PaymentsPage } from '../features/payments/PaymentsPage';
import { AuthProvider } from '../hooks/useAuth';
import { ToastProvider } from '../hooks/useToast';

describe('Phase 5 — Payments Register, Overpayment Guard & Overdue Dunning', () => {
  beforeEach(() => {
    tokenStore.setSession('mock-admin-jwt', {
      id: 'usr-admin-01',
      email: 'admin@brightloop.io',
      role: 'admin',
      customer_id: null,
    });
  });

  it('renders append-only Payments Register with negative Reversal entries and CSV export', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <PaymentsPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('REV-CHQ-009481')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Instrument returned unpaid by clearing house/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Reversal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export CSV/i })).toBeInTheDocument();
  });

  it('blocks overpayment (amount > invoice.balance) in RecordPaymentDrawer with validation error', async () => {
    render(
      <MemoryRouter initialEntries={['/payments?recordForInvoice=inv-02']}>
        <ToastProvider>
          <AuthProvider>
            <PaymentsPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    // Drawer auto-opens for inv-02 (balance 42988.40)
    await waitFor(() => {
      expect(screen.getByText('Record Invoice Payment')).toBeInTheDocument();
      expect(screen.getByDisplayValue('42988.40')).toBeInTheDocument();
    });

    const amountInput = screen.getByLabelText(/Settlement Amount/i);
    fireEvent.change(amountInput, { target: { value: '90000.00' } });

    await waitFor(() => {
      expect(
        screen.getByText(/Overpayment blocked: amount exceeds remaining invoice balance/i)
      ).toBeInTheDocument();
    });

    // Submitting while over-balance keeps error visible and does not close drawer
    const submitButtons = screen.getAllByRole('button', { name: /^Record Payment$/i });
    fireEvent.click(submitButtons[submitButtons.length - 1]);

    expect(screen.getByText('Record Invoice Payment')).toBeInTheDocument();
  });

  it('renders 0-30, 31-60, 61-90, and 90+ aging buckets and dispatches one-click Send Reminder', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <OverdueAgingPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('0-30 days')).toBeInTheDocument();
      expect(screen.getByText('31-60 days')).toBeInTheDocument();
      expect(screen.getByText('61-90 days')).toBeInTheDocument();
      expect(screen.getByText('90+ days')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /Send Reminder/i }).length).toBeGreaterThan(0);
    });

    const remindButtons = screen.getAllByRole('button', { name: /Send Reminder/i });
    expect(remindButtons.length).toBeGreaterThan(0);

    fireEvent.click(remindButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Dunning reminder dispatched to/i)).toBeInTheDocument();
    });
  });
});

