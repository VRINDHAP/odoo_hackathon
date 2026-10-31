import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { evaluatePasswordStrength } from '../utils/validation';
import { formatMoney, normalizeToMonthlyMrr, roundHalfUp } from '../utils/money';
import { isInvoiceOverdue } from '../utils/dates';
import { ForgotPasswordPage } from '../features/auth/ForgotResetPasswordPage';
import { SignupPage } from '../features/auth/SignupPage';
import { AuthProvider } from '../hooks/useAuth';
import { ToastProvider } from '../hooks/useToast';
import { tokenStore } from '../api/tokenStore';

describe('Phase 1 — Core Validators, Money Math & Auth UX', () => {
  beforeEach(() => {
    tokenStore.clearSession();
  });

  it('enforces SPEC.md §8 password strength regex rules accurately', () => {
    expect(evaluatePasswordStrength('Short1!').isValid).toBe(false);
    expect(evaluatePasswordStrength('alllowercase123!').hasUppercase).toBe(false);
    expect(evaluatePasswordStrength('ALLUPPERCASE123!').hasLowercase).toBe(false);
    expect(evaluatePasswordStrength('NoSpecialChar123').hasSpecialChar).toBe(false);

    const strong = evaluatePasswordStrength('Brightloop#2026');
    expect(strong.minLength).toBe(true);
    expect(strong.hasUppercase).toBe(true);
    expect(strong.hasLowercase).toBe(true);
    expect(strong.hasSpecialChar).toBe(true);
    expect(strong.isValid).toBe(true);
  });

  it('formats NUMERIC(14,2) money with half-up rounding and normalizes MRR', () => {
    expect(roundHalfUp(12.345)).toBe(12.35);
    expect(formatMoney('62988.40', 'INR')).toBe('INR 62,988.40');
    expect(formatMoney('-38350.00', 'INR')).toBe('-INR 38,350.00');
    expect(normalizeToMonthlyMrr('48000.00', 'yearly')).toBe(4000);
    expect(normalizeToMonthlyMrr('4500.00', 'monthly')).toBe(4500);
  });

  it('derives overdue invoice badge strictly when confirmed, balance > 0, and due_date < today', () => {
    expect(
      isInvoiceOverdue({ status: 'confirmed', balance: '42988.40', due_date: '2026-10-20' }, '2026-10-31')
    ).toBe(true);
    expect(
      isInvoiceOverdue({ status: 'paid', balance: '0.00', due_date: '2026-10-20' }, '2026-10-31')
    ).toBe(false);
    expect(
      isInvoiceOverdue({ status: 'draft', balance: '1000.00', due_date: '2026-10-20' }, '2026-10-31')
    ).toBe(false);
  });

  it('renders anti-enumeration message on Forgot Password regardless of account existence', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <ForgotPasswordPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/Account Email/i), {
      target: { value: 'nonexistent-user@unknown.org' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send reset link/i }));

    await waitFor(() => {
      expect(screen.getByText('If the email exists, a link was sent')).toBeInTheDocument();
    });
  });

  it('disables Signup submit until live password checklist is completely satisfied', () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <SignupPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    const submitBtn = screen.getByRole('button', { name: /Create account/i });
    expect(submitBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'Test Customer' } });
    fireEvent.change(screen.getByLabelText(/Work Email/i), { target: { value: 'newcust@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'Weak12!' } });
    expect(submitBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'ValidPass#2026' } });
    expect(submitBtn).not.toBeDisabled();
  });
});

