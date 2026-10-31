import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { tokenStore } from '../api/tokenStore';
import { DiscountsPage } from '../features/discounts/DiscountsPage';
import { InvoicesPage } from '../features/invoices/InvoicesPage';
import { InvoiceDetailPage } from '../features/invoices/InvoiceDetailPage';
import { AuthProvider } from '../hooks/useAuth';
import { ToastProvider } from '../hooks/useToast';

describe('Phase 4 — Billing: Discounts, Invoices, Hard Paid Constraint & Billing Run', () => {
  beforeEach(() => {
    tokenStore.setSession('mock-admin-jwt', {
      id: 'usr-admin-01',
      email: 'admin@brightloop.io',
      role: 'admin',
      customer_id: null,
    });
  });

  it('renders Discount Rules with redemption usage tracker', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <DiscountsPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Annual Scale 15% Off')).toBeInTheDocument();
    });
    expect(screen.getByText('34 / 100 redeemed')).toBeInTheDocument();
  });

  it('hides Cancel button on Paid invoice (inv-01) and offers Credit Note guidance instead', async () => {
    render(
      <MemoryRouter initialEntries={['/invoices/inv-01']}>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('INV-2026-000409').length).toBeGreaterThan(0);
    });

    expect(screen.queryByRole('button', { name: /^Cancel$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Issue Credit Note/i })).toBeInTheDocument();
  });

  it('executes Manual Billing Run modal and displays created/skipped/failed summary', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <InvoicesPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('INV-2026-000412')).toBeInTheDocument();
    });

    // Open modal
    fireEvent.click(screen.getByRole('button', { name: /Run Billing Now/i }));
    expect(screen.getByText('Manual Billing Engine Run')).toBeInTheDocument();

    // Execute job inside modal
    const modalButtons = screen.getAllByRole('button', { name: /Run Billing Now/i });
    fireEvent.click(modalButtons[modalButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText(/Billing batch finished/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Zero errors encountered/i)).toBeInTheDocument();
  });
});
