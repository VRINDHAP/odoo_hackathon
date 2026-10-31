import React, { useEffect, useState } from 'react';
import { apiRequest, ApiClientError } from '../../api/client';
import { Button, FormInput, FormSelect } from '../../components/forms/Primitives';
import { useToast } from '../../hooks/useToast';
import type { SystemSettings } from '../../types/domain';
import { isValidEmail, isValidTaxId } from '../../utils/validation';

export const SettingsPage: React.FC = () => {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    apiRequest<SystemSettings>('/settings')
      .then(setSettings)
      .catch(() => showToast('Failed to load system settings', 'error'));
  }, [showToast]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    const nextErrors: Record<string, string> = {};
    if (!settings.company_name.trim()) {
      nextErrors.company_name = 'Company legal name is required.';
    }
    if (!isValidEmail(settings.company_email)) {
      nextErrors.company_email = 'Enter a valid billing support email.';
    }
    if (settings.company_tax_id.trim() && !isValidTaxId(settings.company_tax_id)) {
      nextErrors.company_tax_id = 'Tax registration ID must be 6–20 alphanumeric characters.';
    }
    if (!settings.subscription_prefix.trim()) {
      nextErrors.subscription_prefix = 'Subscription prefix is required.';
    }
    if (!settings.invoice_prefix.trim()) {
      nextErrors.invoice_prefix = 'Invoice prefix is required.';
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setIsSaving(true);
    try {
      const updated = await apiRequest<SystemSettings>('/settings', {
        method: 'PATCH',
        body: settings,
      });
      setSettings(updated);
      showToast('System settings saved and logged to audit trail', 'success');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrors(err.toFieldMap());
      }
      showToast('Failed to update settings', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (!settings) {
    return (
      <div className="product-tile">
        <div className="skeleton-line" style={{ width: '40%', marginBottom: 12 }} />
        <div className="skeleton-line" style={{ width: '75%' }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">Configuration · Admin Only</span>
          <h1 className="type-display-md">System &amp; Billing Settings</h1>
          <p className="type-caption">
            Configure organization details, default document currency, numbering prefixes, and dunning schedules.
          </p>
        </div>
      </header>

      <form onSubmit={handleSave} className="tile-mosaic-2x2">
        <div className="product-tile" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span className="eyebrow-cap">Legal Entity</span>
          <h2 className="type-heading">Organization Profile</h2>
          <FormInput
            label="Company Legal Name"
            value={settings.company_name}
            onChange={(e) => setSettings({ ...settings, company_name: e.target.value })}
            error={errors.company_name}
          />
          <FormInput
            label="Billing Support Email"
            type="email"
            value={settings.company_email}
            onChange={(e) => setSettings({ ...settings, company_email: e.target.value })}
            error={errors.company_email}
          />
          <FormInput
            label="Tax Registration ID (GSTIN / VAT)"
            value={settings.company_tax_id}
            onChange={(e) => setSettings({ ...settings, company_tax_id: e.target.value })}
            error={errors.company_tax_id}
          />
          <FormInput
            label="Registered Billing Address"
            value={settings.company_address}
            onChange={(e) => setSettings({ ...settings, company_address: e.target.value })}
          />
        </div>

        <div className="product-tile" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span className="eyebrow-cap">Numbering &amp; Dunning</span>
          <h2 className="type-heading">Financial Defaults</h2>
          <FormSelect
            label="Default Document Currency"
            value={settings.currency}
            onChange={(e) => setSettings({ ...settings, currency: e.target.value })}
            options={[
              { value: 'INR', label: 'INR — Indian Rupee' },
              { value: 'USD', label: 'USD — US Dollar' },
              { value: 'EUR', label: 'EUR — Euro' },
              { value: 'GBP', label: 'GBP — British Pound' },
            ]}
          />
          <FormInput
            label="Configured Company Timezone"
            value={settings.timezone}
            onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
            helperText="Dates display in company timezone with UTC tooltip."
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormInput
              label="Subscription Prefix"
              value={settings.subscription_prefix}
              onChange={(e) => setSettings({ ...settings, subscription_prefix: e.target.value })}
              error={errors.subscription_prefix}
            />
            <FormInput
              label="Invoice Prefix"
              value={settings.invoice_prefix}
              onChange={(e) => setSettings({ ...settings, invoice_prefix: e.target.value })}
              error={errors.invoice_prefix}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormInput
              label="Pre-Due Reminder (Days)"
              type="number"
              min={0}
              value={String(settings.reminder_days_before_due)}
              onChange={(e) =>
                setSettings({ ...settings, reminder_days_before_due: Math.max(0, Number(e.target.value)) })
              }
            />
            <FormInput
              label="Overdue Cadence (Days)"
              type="number"
              min={1}
              value={String(settings.overdue_reminder_cadence_days)}
              onChange={(e) =>
                setSettings({ ...settings, overdue_reminder_cadence_days: Math.max(1, Number(e.target.value)) })
              }
            />
          </div>

          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="submit" variant="primary" isLoading={isSaving}>
              Save settings
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
};

