import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { tokenStore } from '../api/tokenStore';
import { SubscriptionDetailPage } from '../features/subscriptions/SubscriptionDetailPage';
import { AuthProvider } from '../hooks/useAuth';
import { ToastProvider } from '../hooks/useToast';

describe('Phase 3 — Sales: Subscription Stepper, Live Draft Math & Plan Flag Gating', () => {
  beforeEach(() => {
    tokenStore.setSession('mock-staff-jwt', {
      id: 'usr-staff-01',
      email: 'nandana@brightloop.io',
      role: 'staff',
      customer_id: null,
    });
  });

  it('dynamically recalculates Draft subscription totals on keystroke and blocks qty < plan.min_quantity', async () => {
    render(
      <MemoryRouter initialEntries={['/subscriptions/sub-05']}>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path="/subscriptions/:id" element={<SubscriptionDetailPage />} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Deccan Freight Logistics')).toBeInTheDocument();
    });

    const qtyInput = screen.getByLabelText(/Quantity for line 1/i);
    // Double quantity from 5 to 10 (5300 * 10 = 53,000 + 18% GST 9,540 = 62,540)
    fireEvent.change(qtyInput, { target: { value: '10' } });
    expect(screen.getAllByText('INR 62,540.00').length).toBeGreaterThan(0);

    // Violate plan.min_quantity (5) -> Send Quotation button disables and inline error renders
    fireEvent.change(qtyInput, { target: { value: '2' } });
    expect(screen.getByText('Min 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send Quotation/i })).toBeDisabled();
  });

  it('hides Pause button on Active subscription when plan.pausable is false (sub-02 Enterprise Annual)', async () => {
    render(
      <MemoryRouter initialEntries={['/subscriptions/sub-02']}>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path="/subscriptions/:id" element={<SubscriptionDetailPage />} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Kinetix Robotics Labs')).toBeInTheDocument();
    });

    // plan-annual-scale has pausable: false, closable: true
    expect(screen.queryByRole('button', { name: /^Pause$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close/i })).toBeInTheDocument();
  });

  it('displays prominent Paused banner when subscription is in paused state (sub-03)', async () => {
    render(
      <MemoryRouter initialEntries={['/subscriptions/sub-03']}>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path="/subscriptions/:id" element={<SubscriptionDetailPage />} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Paused: No billing runs will occur/i)).toBeInTheDocument();
    });
  });
});
