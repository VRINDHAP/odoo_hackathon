import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { resetMockDatabase } from '../api/mockEngine';
import { tokenStore } from '../api/tokenStore';
import { WorkspaceLayout } from '../app/WorkspaceLayout';
import { PortalSubscriptionsPage } from '../features/portal/PortalSubscriptionsPage';
import { AuthProvider } from '../hooks/useAuth';
import { ToastProvider } from '../hooks/useToast';
import type { DiscountRule, Invoice, Product, Subscription } from '../types/domain';

describe('PDF Problem Statement Scenes & Professional Navigation Verification', () => {
  beforeEach(() => {
    resetMockDatabase();
    tokenStore.clearSession();
  });

  it('Scene 1 (PDF pp. 1–2): lets customers switch optional add-ons ON and OFF directly in the self-service portal', async () => {
    tokenStore.setSession('mock-cust-jwt', {
      id: 'usr-cust-01',
      email: 'arjun@vervecloud.in',
      role: 'customer',
      customer_id: 'cust-01',
    });

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
      expect(
        screen.getByText(/Optional Add-Ons — Switch On & Off Anytime/i)
      ).toBeInTheDocument();
    });

    // Switch ON "AI Dunning & Multi-Currency Add-on (+INR 1,900.00)"
    const aiAddonSwitch = screen.getByRole('switch', {
      name: /AI Dunning & Multi-Currency Add-on/i,
    });
    expect(aiAddonSwitch).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(aiAddonSwitch);

    await waitFor(() => {
      expect(
        screen.getByText(/Switched ON "AI Dunning & Multi-Currency Add-on"/i)
      ).toBeInTheDocument();
    });

    // Switch it back OFF
    const updatedSwitch = screen.getByRole('switch', {
      name: /AI Dunning & Multi-Currency Add-on/i,
    });
    expect(updatedSwitch).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(updatedSwitch);

    await waitFor(() => {
      expect(
        screen.getByText(/Switched OFF "AI Dunning & Multi-Currency Add-on"/i)
      ).toBeInTheDocument();
    });
  });

  it('Scene 2 (PDF p. 3): configures Brand: Odoo variant adding +560.00 to base product price', async () => {
    tokenStore.setSession('mock-admin-jwt', {
      id: 'usr-admin-01',
      email: 'admin@brightloop.io',
      role: 'admin',
      customer_id: null,
    });

    const products = await apiRequest<Product[]>('/products');
    const coreErp = products.find((p) => p.id === 'prod-01')!;
    const odooVariant = coreErp.variants.find(
      (v) => v.attribute === 'Brand' && v.value === 'Odoo'
    );
    expect(odooVariant).toBeDefined();
    expect(odooVariant?.extra_price).toBe('560.00');
  });

  it('Scenes 4 & 5 (PDF pp. 3–4): creates invoice from subscription with auto-discount and stops automatically once usage limit runs out', async () => {
    tokenStore.setSession('mock-admin-jwt', {
      id: 'usr-admin-01',
      email: 'admin@brightloop.io',
      role: 'admin',
      customer_id: null,
    });

    // Admin creates a high-value 40% promo rule capped at usage_limit = 1
    const promo = await apiRequest<DiscountRule>('/discounts', {
      method: 'POST',
      body: {
        name: 'VIP One-Cycle 40% Rebate',
        type: 'percent',
        value: '40.00',
        min_purchase_amount: '10000.00',
        min_quantity: 1,
        start_date: '2026-01-01',
        end_date: '2027-12-31',
        usage_limit: 1,
        scope: 'subscription',
        product_ids: [],
        is_active: true,
      },
    });
    expect(promo.usage_count).toBe(0);

    // 1st invoice on sub-02 -> 40% discount applies automatically on its own!
    const inv1 = await apiRequest<Invoice>('/invoices', {
      method: 'POST',
      body: { subscription_id: 'sub-02', status: 'confirmed' },
    });
    expect(inv1.discount_name).toBe('VIP One-Cycle 40% Rebate');
    expect(Number.parseFloat(inv1.discount_total)).toBeGreaterThan(100000);

    // Now confirm sub-04 -> active, and create an invoice for sub-04:
    // Because usage_limit (1) ran out on inv1, "VIP One-Cycle 40% Rebate" MUST automatically stop applying!
    await apiRequest<Subscription>('/subscriptions/sub-04/transition', {
      method: 'POST',
      body: { target: 'confirmed' },
    });
    await apiRequest<Subscription>('/subscriptions/sub-04/transition', {
      method: 'POST',
      body: { target: 'active' },
    });

    const inv2 = await apiRequest<Invoice>('/invoices', {
      method: 'POST',
      body: { subscription_id: 'sub-04', status: 'confirmed' },
    });
    expect(inv2.discount_name).not.toBe('VIP One-Cycle 40% Rebate');
  });

  it('opens Global Command Palette on Ctrl+K and filters workspace destinations & records', async () => {
    tokenStore.setSession('mock-admin-jwt', {
      id: 'usr-admin-01',
      email: 'admin@brightloop.io',
      role: 'admin',
      customer_id: null,
    });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route element={<WorkspaceLayout />}>
                <Route path="/dashboard" element={<div>Dashboard Content</div>} />
                <Route path="/discounts" element={<div>Discounts Content</div>} />
              </Route>
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Dashboard Content')).toBeInTheDocument();
    });

    // Press Ctrl+K
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    const searchInput = await screen.findByLabelText(/Global command search/i);
    expect(searchInput).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'Discount Rules' } });
    fireEvent.keyDown(searchInput, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('Discounts Content')).toBeInTheDocument();
    });
  });
});

