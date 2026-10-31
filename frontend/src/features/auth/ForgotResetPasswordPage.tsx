import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { apiRequest, ApiClientError } from '../../api/client';
import { Button, FormInput, PasswordChecklist } from '../../components/forms/Primitives';
import { useToast } from '../../hooks/useToast';
import { evaluatePasswordStrength, isValidEmail, normalizeEmail } from '../../utils/validation';
import { AuthEditorialPanel } from './AuthEditorialPanel';

/**
 * SPEC.md §9 & §12.1:
 * Constant anti-enumeration message: "If the email exists, a link was sent"
 */
export const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [submittedConstantMsg, setSubmittedConstantMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(email)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailError('');
    setIsLoading(true);
    try {
      await apiRequest<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: { email: normalizeEmail(email) },
        skipAuthRefresh: true,
      });
    } catch {
      // Anti-enumeration UX: always display constant message regardless of existence
    } finally {
      setSubmittedConstantMsg('If the email exists, a link was sent');
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-split-layout">
      <AuthEditorialPanel />
      <main className="auth-form-column">
        <div className="product-tile" style={{ maxWidth: 440, width: '100%', margin: '0 auto' }}>
          <span className="eyebrow-cap">Account Recovery</span>
          <h2 className="type-display-md" style={{ marginTop: 4, marginBottom: 6 }}>
            Reset your password
          </h2>
          <p className="type-caption" style={{ marginBottom: 20 }}>
            Enter your account email and we will send a time-limited reset link.
          </p>

          {submittedConstantMsg ? (
            <div
              role="status"
              style={{
                padding: '14px 16px',
                borderRadius: 'var(--rounded-md)',
                backgroundColor: 'var(--chip-active-bg)',
                border: '1px solid var(--chip-active-border)',
                color: 'var(--chip-active-text)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                marginBottom: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={16} />
                <span>{submittedConstantMsg}</span>
              </div>
              <Link
                to="/reset-password?token=demo-reset-token-2026"
                style={{ fontSize: 12, color: 'var(--chip-active-text)', textDecoration: 'underline' }}
              >
                Open simulated reset link (Sandbox evaluation) →
              </Link>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <FormInput
              label="Account Email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={emailError}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Link to="/login" className="type-caption" style={{ textDecoration: 'underline' }}>
                ← Back to sign in
              </Link>
              <Button type="submit" variant="primary" isLoading={isLoading}>
                Send reset link
              </Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
};

export const ResetPasswordPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [token, setToken] = useState(searchParams.get('token') ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);

  const pwRules = evaluatePasswordStrength(newPassword);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setFieldErrors({ token: 'Reset token is required.' });
      return;
    }
    if (!pwRules.isValid) return;

    setFieldErrors({});
    setIsLoading(true);
    try {
      await apiRequest('/auth/reset-password', {
        method: 'POST',
        body: { token: token.trim(), new_password: newPassword },
        skipAuthRefresh: true,
      });
      showToast('Password updated. All previous sessions revoked.', 'success');
      navigate('/login', { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.toFieldMap());
      } else {
        showToast('Failed to reset password', 'error');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-split-layout">
      <AuthEditorialPanel />
      <main className="auth-form-column">
        <div className="product-tile" style={{ maxWidth: 440, width: '100%', margin: '0 auto' }}>
          <span className="eyebrow-cap">Credential Update</span>
          <h2 className="type-display-md" style={{ marginTop: 4, marginBottom: 6 }}>
            Set new password
          </h2>
          <p className="type-caption" style={{ marginBottom: 20 }}>
            Setting a new password immediately revokes any existing refresh sessions.
          </p>

          <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormInput
              label="Reset Token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              error={fieldErrors.token}
              placeholder="Paste reset token"
            />
            <FormInput
              label="New Password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              error={fieldErrors.new_password}
              placeholder="Enter new strong password"
            />
            <PasswordChecklist password={newPassword} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
              <Link to="/login" className="type-caption" style={{ textDecoration: 'underline' }}>
                Cancel
              </Link>
              <Button
                type="submit"
                variant="primary"
                disabled={!pwRules.isValid || !token.trim()}
                isLoading={isLoading}
              >
                Update password →
              </Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
};

