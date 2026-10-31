import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiClientError } from '../../api/client';
import { Button, FormInput, PasswordChecklist } from '../../components/forms/Primitives';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { evaluatePasswordStrength, isValidEmail, normalizeEmail } from '../../utils/validation';
import { AuthEditorialPanel } from './AuthEditorialPanel';

export const SignupPage: React.FC = () => {
  const { signup } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const pwRules = evaluatePasswordStrength(password);
  const canSubmit = Boolean(name.trim()) && isValidEmail(email) && pwRules.isValid && !isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setFieldErrors({});
    setIsSubmitting(true);
    try {
      await signup({
        name: name.trim(),
        email: normalizeEmail(email),
        company_name: companyName.trim() || undefined,
        password,
      });
      showToast('Customer portal account created', 'success');
      navigate('/portal/subscriptions', { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 409) {
          setFieldErrors({ email: 'Email already taken' });
        } else {
          setFieldErrors(err.toFieldMap());
        }
      } else {
        showToast('Could not complete registration', 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-split-layout">
      <AuthEditorialPanel />

      <main className="auth-form-column">
        <div className="product-tile" style={{ maxWidth: 460, width: '100%', margin: '0 auto' }}>
          <span className="eyebrow-cap">Customer Portal Onboarding</span>
          <h2 className="type-display-md" style={{ marginTop: 4, marginBottom: 6 }}>
            Create your account
          </h2>
          <p className="type-caption" style={{ marginBottom: 20 }}>
            Public registration provisions an isolated Customer Portal account.
          </p>

          <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormInput
              label="Full Name"
              placeholder="Priya Nair"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (!name.trim()) {
                  setFieldErrors((p) => ({ ...p, name: 'Full name is required.' }));
                } else {
                  setFieldErrors((p) => {
                    const next = { ...p };
                    delete next.name;
                    return next;
                  });
                }
              }}
              error={fieldErrors.name}
            />

            <FormInput
              label="Work Email"
              type="email"
              placeholder="priya@acme.in"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email) {
                  setFieldErrors((p) => {
                    const next = { ...p };
                    delete next.email;
                    return next;
                  });
                }
              }}
              onBlur={() => {
                if (email && !isValidEmail(email)) {
                  setFieldErrors((p) => ({ ...p, email: 'Enter a valid email address.' }));
                }
              }}
              error={fieldErrors.email}
            />

            <FormInput
              label="Company Name (Optional)"
              placeholder="Acme Systems Pvt Ltd"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />

            <FormInput
              label="Password"
              type="password"
              placeholder="Create a strong password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={fieldErrors.password}
            />

            <PasswordChecklist password={password} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
              <Link to="/login" className="type-caption" style={{ textDecoration: 'underline' }}>
                Already have an account? Sign in
              </Link>
              <Button type="submit" variant="primary" disabled={!canSubmit} isLoading={isSubmitting}>
                Create account →
              </Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
};

