import React, { useCallback, useEffect, useState } from 'react';
import { Lock, Save } from 'lucide-react';
import { apiRequest, ApiClientError } from '../../api/client';
import {
  Button,
  FormInput,
  PasswordChecklist,
} from '../../components/forms/Primitives';
import { useToast } from '../../hooks/useToast';
import type { BillingAddress, Customer } from '../../types/domain';
import { evaluatePasswordStrength } from '../../utils/validation';

const EMPTY_ADDRESS: BillingAddress = {
  line1: '',
  line2: '',
  city: '',
  state: '',
  postal_code: '',
  country: 'India',
};

/**
 * FE-7.3: Customer Portal Profile & Password Management [SPEC.md §2, §8, §9, §12.3]
 * - Strictly queries GET /me/profile and PATCH /me/profile
 * - Allows updating billing address, phone, company name, GST/Tax ID, and portal password
 * - Enforces live regex password checklist ^(?!...)(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$
 */
export const PortalProfilePage: React.FC = () => {
  const { showToast } = useToast();

  const [profile, setProfile] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Profile & Billing Address Form
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [taxId, setTaxId] = useState('');
  const [address, setAddress] = useState<BillingAddress>(EMPTY_ADDRESS);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Password Change Form
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  const loadMyProfile = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiRequest<Customer>('/me/profile');
      setProfile(data);
      setName(data.name);
      setCompanyName(data.company_name);
      setPhone(data.phone);
      setTaxId(data.tax_id);
      setAddress(data.billing_address ?? EMPTY_ADDRESS);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to load profile', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadMyProfile();
  }, [loadMyProfile]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    try {
      const updated = await apiRequest<Customer>('/me/profile', {
        method: 'PATCH',
        body: {
          name: name.trim(),
          company_name: companyName.trim(),
          phone: phone.trim(),
          tax_id: taxId.trim(),
          billing_address: address,
        },
      });
      setProfile(updated);
      showToast('Billing profile and address updated.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update profile', 'error');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const pwRules = evaluatePasswordStrength(newPassword);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwRules.isValid) {
      setPasswordError(
        'Password must be at least 9 characters and include uppercase, lowercase, and a special character.'
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Confirmation password does not match.');
      return;
    }

    setPasswordError('');
    setIsSavingPassword(true);
    try {
      await apiRequest<Customer>('/me/profile', {
        method: 'PATCH',
        body: {
          new_password: newPassword,
        },
      });
      setNewPassword('');
      setConfirmPassword('');
      showToast('Portal password updated.', 'success');
    } catch (err) {
      if (err instanceof ApiClientError) {
        const mapped = err.toFieldMap();
        setPasswordError(mapped.new_password ?? err.message);
      } else {
        showToast('Password update failed', 'error');
      }
    } finally {
      setIsSavingPassword(false);
    }
  };

  if (isLoading) {
    return (
      <div className="product-tile">
        <div className="skeleton-line" style={{ width: '35%', marginBottom: 12 }} />
        <div className="skeleton-line" style={{ width: '75%' }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">Account &amp; Security</span>
          <h1 className="type-display-md">Profile &amp; Billing Address</h1>
          <p className="type-caption">
            Keep your tax invoice billing address and portal credentials up to date.
          </p>
        </div>
      </header>

      <div className="mosaic-grid-2" style={{ alignItems: 'start' }}>
        {/* Billing Address & Contact Card */}
        <form
          onSubmit={(e) => void handleSaveProfile(e)}
          className="product-tile"
          style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <div>
            <span className="eyebrow-cap">Invoice Recipient Details</span>
            <h2 className="type-heading" style={{ marginTop: 4 }}>
              Organization &amp; Billing Address
            </h2>
          </div>

          <div className="mosaic-grid-2">
            <FormInput
              label="Primary Contact Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <FormInput
              label="Account Email (Read-only)"
              value={profile?.email ?? ''}
              disabled
            />
          </div>

          <div className="mosaic-grid-2">
            <FormInput
              label="Company Legal Name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
            />
            <FormInput
              label="Phone Number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          <FormInput
            label="GSTIN / Tax Registration ID"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
          />

          <FormInput
            label="Street Address Line 1"
            value={address.line1}
            onChange={(e) => setAddress((p) => ({ ...p, line1: e.target.value }))}
            required
          />

          <FormInput
            label="Suite / Building Line 2"
            value={address.line2 ?? ''}
            onChange={(e) => setAddress((p) => ({ ...p, line2: e.target.value }))}
          />

          <div className="mosaic-grid-3">
            <FormInput
              label="City"
              value={address.city}
              onChange={(e) => setAddress((p) => ({ ...p, city: e.target.value }))}
              required
            />
            <FormInput
              label="State"
              value={address.state}
              onChange={(e) => setAddress((p) => ({ ...p, state: e.target.value }))}
              required
            />
            <FormInput
              label="Postal Code"
              value={address.postal_code}
              onChange={(e) => setAddress((p) => ({ ...p, postal_code: e.target.value }))}
              required
            />
          </div>

          <FormInput
            label="Country"
            value={address.country}
            onChange={(e) => setAddress((p) => ({ ...p, country: e.target.value }))}
            required
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 6 }}>
            <Button variant="primary" type="submit" isLoading={isSavingProfile}>
              <Save size={14} />
              Save Billing Profile
            </Button>
          </div>
        </form>

        {/* Password Security Card */}
        <form
          onSubmit={(e) => void handleChangePassword(e)}
          className="product-tile"
          style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <div>
            <span className="eyebrow-cap">Portal Credentials</span>
            <h2 className="type-heading" style={{ marginTop: 4 }}>
              Change Password
            </h2>
          </div>

          <FormInput
            label="New Password"
            type="password"
            placeholder="Enter strong password..."
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              if (passwordError) setPasswordError('');
            }}
            error={passwordError || undefined}
          />

          <FormInput
            label="Confirm New Password"
            type="password"
            placeholder="Re-enter new password..."
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (passwordError) setPasswordError('');
            }}
          />

          <PasswordChecklist password={newPassword} />

          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 6 }}>
            <Button variant="outline" type="submit" isLoading={isSavingPassword}>
              <Lock size={14} />
              Update Password
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

