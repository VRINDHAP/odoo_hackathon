import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, RefreshCw } from 'lucide-react';
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
import { useToast } from '../../hooks/useToast';
import type {
  DiscountRule,
  DiscountScope,
  DiscountType,
  Product,
  SystemSettings,
} from '../../types/domain';
import { formatDate, todayIsoDate } from '../../utils/dates';
import { formatMoney, parseMoney, toFixedMoney } from '../../utils/money';

/**
 * FE-4.1: Discount Rules Management Screen (Admin Only) [SPEC.md §2, §5.8, §12.2, §16]
 * - Displays percent/fixed rules, min purchase/qty thresholds, validity dates, and usage progress bar
 * - Polls/refreshes GET /discounts/{id}/usage
 */
export const DiscountsPage: React.FC = () => {
  const { showToast } = useToast();

  const [discounts, setDiscounts] = useState<DiscountRule[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [currency, setCurrency] = useState('INR');
  const [isLoading, setIsLoading] = useState(true);

  // Create / Edit Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<DiscountRule | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [discType, setDiscType] = useState<DiscountType>('percent');
  const [value, setValue] = useState('15.00');
  const [minAmount, setMinAmount] = useState('10000.00');
  const [minQty, setMinQty] = useState('1');
  const [startDate, setStartDate] = useState(todayIsoDate());
  const [endDate, setEndDate] = useState('');
  const [usageLimit, setUsageLimit] = useState('100');
  const [scope, setScope] = useState<DiscountScope>('subscription');
  const [selectedProdId, setSelectedProdId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  const loadDiscounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const [discList, prodList, settings] = await Promise.all([
        apiRequest<DiscountRule[]>('/discounts'),
        apiRequest<Product[]>('/products'),
        apiRequest<SystemSettings>('/settings'),
      ]);
      setDiscounts(discList);
      setProducts(prodList);
      if (prodList[0]) setSelectedProdId(prodList[0].id);
      setCurrency(settings.currency);
    } catch {
      showToast('Failed to load discount rules', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadDiscounts();
  }, [loadDiscounts]);

  const openCreate = () => {
    setEditingRule(null);
    setName('');
    setCode('');
    setDiscType('percent');
    setValue('15.00');
    setMinAmount('10000.00');
    setMinQty('1');
    setStartDate(todayIsoDate());
    setEndDate('');
    setUsageLimit('100');
    setScope('subscription');
    setIsActive(true);
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEdit = (rule: DiscountRule) => {
    setEditingRule(rule);
    setName(rule.name);
    setCode(rule.code ?? '');
    setDiscType(rule.type);
    setValue(rule.value);
    setMinAmount(rule.min_purchase_amount);
    setMinQty(String(rule.min_quantity));
    setStartDate(rule.start_date);
    setEndDate(rule.end_date ?? '');
    setUsageLimit(rule.usage_limit !== null ? String(rule.usage_limit) : '');
    setScope(rule.scope);
    setSelectedProdId(rule.product_ids[0] ?? products[0]?.id ?? '');
    setIsActive(rule.is_active);
    setFormErrors({});
    setIsModalOpen(true);
  };

  const refreshUsage = async (ruleId: string) => {
    try {
      const usage = await apiRequest<{ id: string; usage_count: number; usage_limit: number | null }>(
        `/discounts/${ruleId}/usage`
      );
      setDiscounts((prev) =>
        prev.map((d) =>
          d.id === ruleId
            ? { ...d, usage_count: usage.usage_count, usage_limit: usage.usage_limit }
            : d
        )
      );
      showToast('Synced live redemption usage counter', 'success');
    } catch {
      showToast('Could not refresh redemption usage', 'error');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Discount rule name is required.';
    const valNum = Number.parseFloat(value);
    if (Number.isNaN(valNum) || valNum <= 0) {
      errs.value = 'Discount value must be greater than zero.';
    } else if (discType === 'percent' && valNum > 100) {
      errs.value = 'Percentage discount cannot exceed 100%.';
    }
    const minAmtNum = Number.parseFloat(minAmount);
    if (Number.isNaN(minAmtNum) || minAmtNum < 0) {
      errs.min_purchase_amount = 'Minimum purchase amount cannot be negative.';
    }
    const minQtyNum = Number.parseInt(minQty, 10);
    if (Number.isNaN(minQtyNum) || minQtyNum < 1) {
      errs.min_quantity = 'Minimum quantity must be at least 1.';
    }
    if (endDate && endDate < startDate) {
      errs.end_date = 'End date must be on or after start date.';
    }
    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      return;
    }

    setFormErrors({});
    setIsSaving(true);
    try {
      const payload = {
        ...(editingRule ? { id: editingRule.id } : {}),
        name: name.trim(),
        code: code.trim().toUpperCase() || undefined,
        type: discType,
        value: toFixedMoney(valNum),
        min_purchase_amount: toFixedMoney(minAmtNum),
        min_quantity: minQtyNum,
        start_date: startDate,
        end_date: endDate || null,
        usage_limit: usageLimit.trim() ? Math.max(1, Number.parseInt(usageLimit, 10)) : null,
        scope,
        product_ids: scope === 'product' && selectedProdId ? [selectedProdId] : [],
        is_active: isActive,
      };

      if (editingRule) {
        const updated = await apiRequest<DiscountRule>('/discounts', {
          method: 'PATCH',
          body: payload,
        });
        setDiscounts((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
        showToast(`Updated "${updated.name}"`, 'success');
      } else {
        const created = await apiRequest<DiscountRule>('/discounts', {
          method: 'POST',
          body: payload,
        });
        setDiscounts((prev) => [created, ...prev]);
        showToast(`Created discount "${created.name}"`, 'success');
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

  const columns: DataColumn<DiscountRule>[] = [
    {
      key: 'name',
      header: 'Rule & Coupon Code',
      sortValue: (d) => d.name,
      render: (d) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{d.name}</span>
            {d.code ? <StatusChip status={d.code} variant="yellow" showDot={false} /> : null}
          </div>
          <span className="type-caption">
            Scope: {d.scope} · Min {formatMoney(d.min_purchase_amount, currency)} · Min Qty {d.min_quantity}
          </span>
        </div>
      ),
    },
    {
      key: 'benefit',
      header: 'Deduction',
      align: 'right',
      sortValue: (d) => parseMoney(d.value),
      render: (d) =>
        d.type === 'percent' ? `${toFixedMoney(d.value)}%` : formatMoney(d.value, currency),
    },
    {
      key: 'window',
      header: 'Validity Window',
      render: (d) => (
        <span className="type-caption">
          {formatDate(d.start_date)} → {d.end_date ? formatDate(d.end_date) : 'Open-ended'}
        </span>
      ),
    },
    {
      key: 'usage',
      header: 'Redemption Tracker',
      render: (d) => {
        const pct =
          d.usage_limit && d.usage_limit > 0
            ? Math.min(100, Math.round((d.usage_count / d.usage_limit) * 100))
            : 0;
        return (
          <div style={{ minWidth: 165, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span>
                {d.usage_count} / {d.usage_limit ?? '∞'} redeemed
              </span>
              {d.usage_limit ? <span>{pct}%</span> : null}
            </div>
            <div
              style={{
                height: 6,
                borderRadius: 9999,
                backgroundColor: 'var(--color-canvas-sand)',
                overflow: 'hidden',
                border: '1px solid var(--color-hairline)',
              }}
            >
              <div
                style={{
                  width: d.usage_limit ? `${pct}%` : '22%',
                  height: '100%',
                  backgroundColor: pct >= 90 ? 'var(--color-blaze)' : 'var(--color-ink)',
                }}
              />
            </div>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (d) => {
        const expired = d.end_date ? d.end_date < todayIsoDate() : false;
        if (expired) return <StatusChip status="Expired" variant="cancelled" />;
        return (
          <StatusChip
            status={d.is_active ? 'Active' : 'Paused'}
            variant={d.is_active ? 'active' : 'draft'}
          />
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (d) => (
        <div style={{ display: 'inline-flex', gap: 6 }}>
          <Button
            variant="sand"
            onClick={() => void refreshUsage(d.id)}
            title="Sync redemption usage"
            aria-label={`Sync usage for ${d.name}`}
          >
            <RefreshCw size={13} />
          </Button>
          <Button variant="outline" onClick={() => openEdit(d)}>
            <Pencil size={13} />
            Edit
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">Promotional Ledger · Admin Only</span>
          <h1 className="type-display-md">Discount Rules &amp; Redemptions</h1>
          <p className="type-caption">
            Discounts are evaluated at invoice generation date (best single eligible rule applied). Cancelling an unpaid invoice releases its redemption count.
          </p>
        </div>

        <div className="page-header-actions">
          <Button variant="primary" onClick={openCreate}>
            <Plus size={15} />
            New Discount Rule
          </Button>
        </div>
      </header>

      <DataTable
        columns={columns}
        rows={discounts}
        rowKey={(d) => d.id}
        isLoading={isLoading}
        emptyTitle="No discount rules configured"
        emptyDescription="Create percentage or fixed promotional rules for subscriptions or specific catalog SKUs."
      />

      <Modal
        isOpen={isModalOpen}
        title={editingRule ? `Edit ${editingRule.name}` : 'Create Discount Rule'}
        eyebrow="Discount Policy"
        onClose={() => setIsModalOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} isLoading={isSaving}>
              {editingRule ? 'Save Rule' : 'Create Rule'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <FormInput
              label="Rule Name"
              placeholder="Annual Scale 15% Off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={formErrors.name}
            />
            <FormInput
              label="Coupon Code (Optional)"
              placeholder="SCALE15"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <FormSelect
              label="Discount Type"
              value={discType}
              onChange={(e) => setDiscType(e.target.value as DiscountType)}
              options={[
                { value: 'percent', label: 'Percentage (%)' },
                { value: 'fixed', label: `Fixed (${currency})` },
              ]}
            />
            <FormInput
              label={discType === 'percent' ? 'Percent (%)' : `Fixed (${currency})`}
              type="number"
              min="0.01"
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              error={formErrors.value}
            />
            <FormSelect
              label="Rule Scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as DiscountScope)}
              options={[
                { value: 'subscription', label: 'Entire Subscription' },
                { value: 'product', label: 'Specific Product' },
              ]}
            />
          </div>

          {scope === 'product' ? (
            <FormSelect
              label="Eligible Product SKU"
              value={selectedProdId}
              onChange={(e) => setSelectedProdId(e.target.value)}
              options={products.map((p) => ({ value: p.id, label: p.name }))}
            />
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <FormInput
              label={`Min Purchase (${currency})`}
              type="number"
              min="0"
              step="0.01"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              error={formErrors.min_purchase_amount}
            />
            <FormInput
              label="Min Quantity"
              type="number"
              min="1"
              value={minQty}
              onChange={(e) => setMinQty(e.target.value)}
              error={formErrors.min_quantity}
            />
            <FormInput
              label="Redemption Cap"
              type="number"
              min="1"
              placeholder="Unlimited"
              value={usageLimit}
              onChange={(e) => setUsageLimit(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FormInput
              label="Valid Start Date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <FormInput
              label="Valid End Date (Optional)"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              error={formErrors.end_date}
            />
          </div>

          <ToggleSwitch label="Rule Active" checked={isActive} onChange={setIsActive} />
        </form>
      </Modal>
    </div>
  );
};

