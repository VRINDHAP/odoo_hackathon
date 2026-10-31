import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { apiRequest, ApiClientError } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import {
  Button,
  FormInput,
  FormSelect,
  Modal,
  ToggleSwitch,
} from '../../components/forms/Primitives';
import { DataTable, type DataColumn } from '../../components/tables/DataTable';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import type { SystemSettings, TaxAppliesTo, TaxRule, TaxType } from '../../types/domain';
import { formatMoney, parseMoney, roundHalfUp, toFixedMoney } from '../../utils/money';

/**
 * FE-2.3: Tax Rules Configuration Screen [SPEC.md §2, §5.7, §12.2]
 * - Displays name, percent/fixed rate, distinct Inclusive vs Exclusive badge, applicability tag
 * - Admin: create & edit tax rules; Staff: read-only table
 */
export const TaxesPage: React.FC = () => {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();

  const [taxes, setTaxes] = useState<TaxRule[]>([]);
  const [currency, setCurrency] = useState('INR');
  const [isLoading, setIsLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTax, setEditingTax] = useState<TaxRule | null>(null);
  const [name, setName] = useState('');
  const [taxType, setTaxType] = useState<TaxType>('percent');
  const [rate, setRate] = useState('18.00');
  const [inclusive, setInclusive] = useState(false);
  const [appliesTo, setAppliesTo] = useState<TaxAppliesTo>('all');
  const [isActive, setIsActive] = useState(true);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  const loadTaxes = useCallback(async () => {
    setIsLoading(true);
    try {
      const [taxList, settings] = await Promise.all([
        apiRequest<TaxRule[]>('/taxes'),
        apiRequest<SystemSettings>('/settings'),
      ]);
      setTaxes(taxList);
      setCurrency(settings.currency);
    } catch {
      showToast('Failed to load tax schedules', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadTaxes();
  }, [loadTaxes]);

  const openCreate = () => {
    setEditingTax(null);
    setName('');
    setTaxType('percent');
    setRate('18.00');
    setInclusive(false);
    setAppliesTo('all');
    setIsActive(true);
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEdit = (tax: TaxRule) => {
    setEditingTax(tax);
    setName(tax.name);
    setTaxType(tax.type);
    setRate(tax.rate);
    setInclusive(tax.inclusive);
    setAppliesTo(tax.applies_to);
    setIsActive(tax.is_active);
    setFormErrors({});
    setIsModalOpen(true);
  };

  const handleSaveTax = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Tax rule name is required (e.g. GST 18%).';
    const rateNum = Number.parseFloat(rate);
    if (Number.isNaN(rateNum) || rateNum < 0) {
      errs.rate = 'Tax rate must be 0 or higher.';
    } else if (taxType === 'percent' && rateNum > 100) {
      errs.rate = 'Percentage tax rate cannot exceed 100%.';
    }
    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      return;
    }

    setFormErrors({});
    setIsSaving(true);
    try {
      const payload = {
        ...(editingTax ? { id: editingTax.id } : {}),
        name: name.trim(),
        type: taxType,
        rate: toFixedMoney(rateNum),
        inclusive,
        applies_to: appliesTo,
        is_active: isActive,
      };

      if (editingTax) {
        const updated = await apiRequest<TaxRule>('/taxes', {
          method: 'PATCH',
          body: payload,
        });
        setTaxes((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        showToast(`Updated tax rule "${updated.name}"`, 'success');
      } else {
        const created = await apiRequest<TaxRule>('/taxes', {
          method: 'POST',
          body: payload,
        });
        setTaxes((prev) => [...prev, created]);
        showToast(`Created tax rule "${created.name}"`, 'success');
      }
      setIsModalOpen(false);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormErrors(err.toFieldMap());
        showToast(err.message, 'error');
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Sample 10,000.00 preview inside modal
  const sampleBase = 10000;
  const parsedRate = parseMoney(rate);
  const sampleTax =
    taxType === 'fixed'
      ? parsedRate
      : inclusive
        ? roundHalfUp(sampleBase - sampleBase / (1 + parsedRate / 100))
        : roundHalfUp((sampleBase * parsedRate) / 100);
  const sampleTotal = inclusive ? sampleBase : roundHalfUp(sampleBase + sampleTax);

  const columns: DataColumn<TaxRule>[] = [
    {
      key: 'name',
      header: 'Tax Schedule Name',
      sortValue: (t) => t.name,
      render: (t) => <span>{t.name}</span>,
    },
    {
      key: 'mode',
      header: 'Calculation Mode',
      render: (t) => (
        <StatusChip
          status={t.inclusive ? 'Inclusive' : 'Exclusive'}
          variant={t.inclusive ? 'active' : 'neutral'}
        />
      ),
    },
    {
      key: 'applies_to',
      header: 'Applicability',
      render: (t) => <StatusChip status={`Applies: ${t.applies_to}`} variant="confirmed" showDot={false} />,
    },
    {
      key: 'rate',
      header: 'Rate / Levy',
      align: 'right',
      sortValue: (t) => parseMoney(t.rate),
      render: (t) =>
        t.type === 'percent' ? `${toFixedMoney(t.rate)}%` : formatMoney(t.rate, currency),
    },
    {
      key: 'status',
      header: 'Status',
      render: (t) => (
        <StatusChip
          status={t.is_active ? 'Active' : 'Inactive'}
          variant={t.is_active ? 'active' : 'draft'}
        />
      ),
    },
    ...(isAdmin
      ? ([
          {
            key: 'actions',
            header: 'Actions',
            align: 'right' as const,
            render: (t: TaxRule) => (
              <Button variant="outline" onClick={() => openEdit(t)}>
                <Pencil size={13} />
                Edit Rule
              </Button>
            ),
          },
        ] satisfies DataColumn<TaxRule>[])
      : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">
            Tax Compliance · {isAdmin ? 'Admin Write' : 'Staff Read-Only'}
          </span>
          <h1 className="type-display-md">Tax Rules &amp; Schedules</h1>
          <p className="type-caption">
            Configure GST/VAT percentage rates or flat regulatory levies with inclusive or exclusive calculation modes.
          </p>
        </div>

        {isAdmin ? (
          <div className="page-header-actions">
            <Button variant="primary" onClick={openCreate}>
              <Plus size={15} />
              New Tax Rule
            </Button>
          </div>
        ) : (
          <StatusChip status="Read-Only Access" variant="neutral" />
        )}
      </header>

      <DataTable
        columns={columns}
        rows={taxes}
        rowKey={(t) => t.id}
        isLoading={isLoading}
        emptyTitle="No tax rules configured"
        emptyDescription="Create a GST or VAT tax rule to automatically compute subscription and invoice taxes."
      />

      <Modal
        isOpen={isModalOpen}
        title={editingTax ? `Edit ${editingTax.name}` : 'Create Tax Rule'}
        eyebrow="Tax Schedule"
        onClose={() => setIsModalOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveTax} isLoading={isSaving}>
              {editingTax ? 'Save Tax Rule' : 'Create Tax Rule'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSaveTax} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormInput
            label="Tax Rule Name"
            placeholder="GST 18%"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={formErrors.name}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <FormSelect
              label="Rate Type"
              value={taxType}
              onChange={(e) => setTaxType(e.target.value as TaxType)}
              options={[
                { value: 'percent', label: 'Percentage (%)' },
                { value: 'fixed', label: `Fixed (${currency})` },
              ]}
            />
            <FormInput
              label={taxType === 'percent' ? 'Rate (%)' : `Amount (${currency})`}
              type="number"
              min="0"
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              error={formErrors.rate}
            />
            <FormSelect
              label="Applies To"
              value={appliesTo}
              onChange={(e) => setAppliesTo(e.target.value as TaxAppliesTo)}
              options={[
                { value: 'all', label: 'All Items' },
                { value: 'product', label: 'Specific Product' },
                { value: 'category', label: 'Product Category' },
              ]}
            />
          </div>

          <ToggleSwitch
            label="Tax Inclusive Pricing"
            description="When enabled, unit price already includes tax; otherwise tax is added on top."
            checked={inclusive}
            onChange={setInclusive}
          />

          <ToggleSwitch
            label="Active Schedule"
            description="Available for assignment on catalog products and invoices."
            checked={isActive}
            onChange={setIsActive}
          />

          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--rounded-md)',
              backgroundColor: 'var(--color-canvas-sand)',
              border: '1px solid var(--color-hairline)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span className="type-caption">
              Sample on {formatMoney(sampleBase, currency)} ({inclusive ? 'Inclusive' : 'Exclusive'})
            </span>
            <span className="money-cell">
              Tax: {formatMoney(sampleTax, currency)} → Total: {formatMoney(sampleTotal, currency)}
            </span>
          </div>
        </form>
      </Modal>
    </div>
  );
};

