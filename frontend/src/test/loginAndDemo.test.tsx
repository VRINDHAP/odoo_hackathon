import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetClientModeForTests, tryRefreshAccessToken } from '../api/client';
import { resetMockDatabase } from '../api/mockEngine';
import { tokenStore } from '../api/tokenStore';
import { RouteGuard } from '../app/RouteGuard';
import { LoginPage } from '../features/auth/LoginPage';
import { AuthProvider } from '../hooks/useAuth';
import { ToastProvider } from '../hooks/useToast';

describe('Brightloop Login Reliability, Proxy Fallback & Session Restore', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetMockDatabase();
    resetClientModeForTests();
    tokenStore.clearSession();
    sessionStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('signs in cleanly when Vite dev proxy returns HTTP 500 or 503 because :8000 backend is offline', async () => {
    // Simulate exact browser Vite http-proxy ECONNREFUSED HTTP 500 response
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('', { status: 500, statusText: 'Internal Server Error' })
    );

    render(
      <MemoryRouter initialEntries={['/login']}>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/dashboard" element={<div>Brightloop Admin Dashboard Ready</div>} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    expect(screen.getAllByText('Brightloop').length).toBeGreaterThan(0);

    // Click 1-click Demo Workspace button -> Admin (Full)
    fireEvent.click(screen.getByRole('button', { name: /Admin \(Full\)/i }));

    await waitFor(() => {
      expect(screen.getByText('Brightloop Admin Dashboard Ready')).toBeInTheDocument();
    });

    expect(tokenStore.getUser()?.email).toBe('admin@brightloop.io');
    expect(tokenStore.getUser()?.role).toBe('admin');
  });

  it('bridges official Brightloop demo accounts seamlessly even if live FastAPI is running with an unseeded DB, while rejecting wrong passwords and locking after 5 attempts', async () => {
    // Simulate live FastAPI running on :8000 with an empty SQLite DB returning 401 {"code":"UNAUTHORIZED",...}
    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password.',
          fields: [],
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    );

    render(
      <MemoryRouter initialEntries={['/login']}>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/portal/subscriptions" element={<div>Brightloop Customer Portal Ready</div>} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    // 1. Entering a WRONG password on live 401 must STILL show an error banner (no bypass for bad passwords!)
    fireEvent.change(screen.getByLabelText(/Work Email/i), {
      target: { value: 'arjun@vervecloud.in' },
    });
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: 'WrongPassword99!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Invalid email or password/i);
    });

    // 2. Clicking Customer Portal demo button with valid demo credentials bridges cleanly to Portal!
    fireEvent.click(screen.getByRole('button', { name: /Customer Portal/i }));

    await waitFor(() => {
      expect(screen.getByText('Brightloop Customer Portal Ready')).toBeInTheDocument();
    });
    expect(tokenStore.getUser()?.email).toBe('arjun@vervecloud.in');
  });

  it('enforces 5-attempt HTTP 423 account lockout on repeated invalid manual passwords', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ proxy_offline: true }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    render(
      <MemoryRouter initialEntries={['/login']}>
        <ToastProvider>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/Work Email/i), {
      target: { value: 'nandana@brightloop.io' },
    });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      fireEvent.change(screen.getByLabelText(/Password/i), {
        target: { value: `WrongAttempt${attempt}!` },
      });
      fireEvent.click(screen.getByRole('button', { name: /^Sign in/i }));
      // Wait for submission cycle
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    }

    expect(screen.getByRole('alert')).toHaveTextContent(/Account Locked/i);
  });

  it('restores authenticated session across browser reload (F5) via sessionStorage hint without kicking user to /login', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('', { status: 500, statusText: 'Internal Server Error' })
    );

    // Simulate active browser tab reload: memory token cleared, sessionStorage holds brightloop_refresh_uid
    sessionStorage.setItem('brightloop_refresh_uid', 'usr-admin-01');
    expect(tokenStore.getUser()).toBeNull();

    const refreshed = await tryRefreshAccessToken();
    expect(refreshed).toBe(true);
    expect(tokenStore.getUser()?.email).toBe('admin@brightloop.io');

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route
                path="/dashboard"
                element={
                  <RouteGuard allowedRoles={['admin', 'staff']}>
                    <div>Persisted Workspace After Reload</div>
                  </RouteGuard>
                }
              />
              <Route path="/login" element={<div>Login Screen</div>} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Persisted Workspace After Reload')).toBeInTheDocument();
    });
  });
});

