import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Lock, Zap } from 'lucide-react';
import { ApiClientError } from '../../api/client';
import { Button, FormInput } from '../../components/forms/Primitives';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { isValidEmail, normalizeEmail } from '../../utils/validation';
import { AuthEditorialPanel } from './AuthEditorialPanel';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [bannerError, setBannerError] = useState<{ code: string; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const performLogin = async (targetEmail: string, targetPassword: string) => {
    setBannerError(null);
    setFieldErrors({});
    setIsSubmitting(true);
    try {
      const loggedInUser = await login(normalizeEmail(targetEmail), targetPassword);
      showToast(`Signed in as ${loggedInUser.email}`, 'success');
      const from = (location.state as { from?: string } | null)?.from;
      if (loggedInUser.role === 'customer') {
        navigate('/portal/subscriptions', { replace: true });
      } else if (from && !from.startsWith('/portal')) {
        navigate(from, { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.toFieldMap());
        setBannerError({ code: err.code, message: err.message });
      } else {
        setBannerError({ code: 'NETWORK_ERROR', message: 'Unable to reach authentication service.' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!isValidEmail(email)) {
      errors.email = 'Enter a valid email address.';
    }
    if (!password) {
      errors.password = 'Password is required.';
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    await performLogin(email, password);
  };

  return (
    <div className="auth-split-layout">
      <AuthEditorialPanel />

      <main className="auth-form-column">
        <div className="product-tile" style={{ maxWidth: 420, width: '100%', margin: '0 auto', padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div className="brand-mark mobile-only" style={{ fontSize: 16 }}>
              <span className="brand-bolt" title="Brightloop">
                <Zap size={13} />
              </span>
              <span>Brightloop</span>
            </div>
            <span className="eyebrow-cap">Workspace Access</span>
            <span className="brand-bolt desktop-only" title="Brightloop">
              <Zap size={13} />
            </span>
          </div>

          <h2 className="type-display-md" style={{ marginBottom: 4 }}>
            Sign in
          </h2>
          <p className="type-caption" style={{ marginBottom: 22 }}>
            Continue with your Brightloop credentials or launch a demo workspace.
          </p>

          {bannerError ? (
            <div
              role="alert"
              style={{
                padding: '11px 14px',
                borderRadius: 'var(--rounded-md)',
                backgroundColor: 'var(--chip-cancelled-bg)',
                border: '1px solid var(--chip-cancelled-border)',
                color: 'var(--chip-cancelled-text)',
                marginBottom: 16,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                fontSize: 13,
              }}
            >
              <Lock size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                {bannerError.code === 'ACCOUNT_LOCKED' ? (
                  <div style={{ marginBottom: 2 }}>Account Locked</div>
                ) : null}
                <span>{bannerError.message}</span>
              </div>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormInput
              label="Work Email"
              type="email"
              placeholder="you@brightloop.io"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => {
                if (email && !isValidEmail(email)) {
                  setFieldErrors((prev) => ({ ...prev, email: 'Enter a valid email address.' }));
                } else {
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.email;
                    return next;
                  });
                }
              }}
              error={fieldErrors.email}
              autoComplete="email"
            />

            <FormInput
              label="Password"
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={fieldErrors.password}
              autoComplete="current-password"
              rightHint={
                <Link to="/forgot-password" style={{ fontSize: 12 }}>
                  Forgot password?
                </Link>
              }
            />

            <Button
              type="submit"
              variant="primary"
              isLoading={isSubmitting}
              style={{ width: '100%', padding: '10px 16px', marginTop: 4 }}
            >
              Sign in →
            </Button>
          </form>

          {/* 1-Click Demo Workspaces */}
          <div
            style={{
              marginTop: 22,
              paddingTop: 18,
              borderTop: '1px solid var(--color-hairline)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <span className="eyebrow-cap" style={{ lineHeight: '14px' }}>
              Demo Workspaces
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
              <Button
                type="button"
                variant="sand"
                disabled={isSubmitting}
                style={{ fontSize: 12, padding: '8px 6px' }}
                onClick={() => {
                  setEmail('admin@brightloop.io');
                  setPassword('Admin@2026!');
                  void performLogin('admin@brightloop.io', 'Admin@2026!');
                }}
              >
                Admin (Full)
              </Button>
              <Button
                type="button"
                variant="sand"
                disabled={isSubmitting}
                style={{ fontSize: 12, padding: '8px 6px' }}
                onClick={() => {
                  setEmail('nandana@brightloop.io');
                  setPassword('Staff@2026!');
                  void performLogin('nandana@brightloop.io', 'Staff@2026!');
                }}
              >
                Internal Staff
              </Button>
              <Button
                type="button"
                variant="sand"
                disabled={isSubmitting}
                style={{ fontSize: 12, padding: '8px 6px' }}
                onClick={() => {
                  setEmail('arjun@vervecloud.in');
                  setPassword('Customer@2026!');
                  void performLogin('arjun@vervecloud.in', 'Customer@2026!');
                }}
              >
                Customer Portal
              </Button>
            </div>
          </div>

          <div style={{ marginTop: 18, fontSize: 13, color: 'var(--color-ink-mute)', textAlign: 'center' }}>
            New customer?{' '}
            <Link to="/signup" style={{ color: 'var(--color-ink)', textDecoration: 'underline' }}>
              Create a portal account
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
};
