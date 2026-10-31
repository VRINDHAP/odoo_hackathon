import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { tokenStore } from '../api/tokenStore';
import { ProductsPage } from '../features/catalog/ProductsPage';
import { PlansPage } from '../features/plans/PlansPage';
import { TaxesPage } from '../features/taxes/TaxesPage';
import { AuthProvider } from '../hooks/useAuth';
import { ToastProvider } from '../hooks/useToast';

describe('Phase 2 — Catalog: Products, Variants, Plans & Taxes RBAC', () => {
  beforeEach(() => {
    tokenStore.clearSession();
  });

  it('displays Unit Margin and New Product CTA to Admin users', async () => {
    tokenStore.setSession('mock-admin-jwt', {
      id: 'usr-admin-01',
      email: 'admin@brightloop.io',
      role: 'admin',
      customer_id: null,
    });

    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <ProductsPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('SSVN Systems Core ERP Suite')).toBeInTheDocument();
    });

    expect(screen.getByText('Unit Margin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New Product/i })).toBeInTheDocument();
  });

  it('hides Cost Price, Unit Margin, and product mutation buttons from Internal Staff', async () => {
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
            <ProductsPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('SSVN Systems Core ERP Suite')).toBeInTheDocument();
    });

    expect(screen.queryByText('Unit Margin')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New Product/i })).not.toBeInTheDocument();
    expect(screen.getByText('Read-Only Access')).toBeInTheDocument();
  });

  it('renders Plans mosaic with behavior flags and Taxes with Inclusive/Exclusive badges', async () => {
    tokenStore.setSession('mock-admin-jwt', {
      id: 'usr-admin-01',
      email: 'admin@brightloop.io',
      role: 'admin',
      customer_id: null,
    });

    const { unmount } = render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <PlansPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Growth Monthly')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Pausable').length).toBeGreaterThan(0);
    unmount();

    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <TaxesPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('GST 18%')).toBeInTheDocument();
    });
    expect(screen.getByText('Inclusive')).toBeInTheDocument();
    expect(screen.getAllByText('Exclusive').length).toBeGreaterThan(0);
  });
});

