import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { apiRequest, ApiClientError } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import {
  Button,
  FormInput,
  FormSelect,
  Modal,
  SegmentedTabs,
  ToggleSwitch,
} from '../../components/forms/Primitives';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import type { BillingPeriod, Plan, SystemSettings } from '../../types/domain';
import { formatDate, todayIsoDate } from '../../utils/dates';
import { formatMoney, normalizeToMonthlyMrr, toFixedMoney } from '../../utils/money';

/**
 * FE-2.2: Plans Configuration Screen with Behavior Flags [SPEC.md §2, §5.4, §12.2]
 * - Rendered in Ramp's 2x2 Product-Tile Mosaic
 * - Billing periods: daily | weekly | monthly | yearly
 * - Flags: auto_close, closable, pausable, renewable, is_active
 * - Admin: full edit & instant toggle persistence; Staff: strict read-only
 */
export const PlansPage: React.FC = () => {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [currency, setCurrency] = useState('INR');
  const [isLoading, setIsLoading] = useState(true);
  const [periodFilter, setPeriodFilter] = useState<string>('');

  // Create / Edit Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('4500.00');
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('monthly');
  const [minQuantity, setMinQuantity] = useState('1');
  const [validFrom, setValidFrom] = useState(todayIsoDate());
  const [validTo, setValidTo] = useState('');
  const [autoClose, setAutoClose] = useState(false);
  const [closable, setClosable] = useState(true);
  const [pausable, setPausable] = useState(true);
  const [renewable, setRenewable] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  const loadPlans = useCallback(async () => {
    setIsLoading(true);
    try {
      const [planList, settings] = await Promise.all([
        apiRequest<Plan[]>('/plans'),
        apiRequest<SystemSettings>('/settings'),
      ]);
      setPlans(planList);
      setCurrency(settings.currency);
    } catch {
      showToast('Failed to load billing plans', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const openCreate = () => {
    setEditingPlan(null);
    setName('');
    setPrice('4500.00');
    setBillingPeriod('monthly');
    setMinQuantity('1');
    setValidFrom(todayIsoDate());
    setValidTo('');
    setAutoClose(false);
    setClosable(true);
    setPausable(true);
    setRenewable(true);
    setIsActive(true);
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEdit = (plan: Plan) => {
    setEditingPlan(plan);
    setName(plan.name);
    setPrice(plan.price);
    setBillingPeriod(plan.billing_period);
    setMinQuantity(String(plan.min_quantity));
    setValidFrom(plan.valid_from);
    setValidTo(plan.valid_to ?? '');
    setAutoClose(plan.auto_close);
    setClosable(plan.closable);
    setPausable(plan.pausable);
    setRenewable(plan.renewable);
    setIsActive(plan.is_active);
    setFormErrors({});
    setIsModalOpen(true);
  };

  const handleToggleFlag = async (
    plan: Plan,
    flag: 'auto_close' | 'closable' | 'pausable' | 'renewable' | 'is_active',
    nextVal: boolean
  ) => {
    if (!isAdmin) return;
    try {
      const updated = await apiRequest<Plan>(`/plans/${plan.id}`, {
        method: 'PATCH',
        body: { [flag]: nextVal },
      });
      setPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      showToast(`Updated ${flag.replace('_', ' ')} on "${plan.name}"`, 'success');
    } catch {
      showToast('Failed to update plan flag', 'error');
    }
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Plan name is required.';
    const priceNum = Number.parseFloat(price);
    if (Number.isNaN(priceNum) || priceNum < 0) errs.price = 'Price must be 0.00 or greater.';
    const minQtyNum = Number.parseInt(minQuantity, 10);
    if (Number.isNaN(minQtyNum) || minQtyNum < 1) {
      errs.min_quantity = 'Minimum quantity must be a positive integer (>= 1).';
    }
    if (!validFrom) errs.valid_from = 'Valid-from date is required.';
    if (validTo && validTo < validFrom) {
      errs.valid_to = 'Valid-to date cannot precede valid-from date.';
    }
    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      return;
    }

    setFormErrors({});
    setIsSaving(true);
    try {
      const payload = {
        name: name.trim(),
        price: toFixedMoney(priceNum),
        billing_period: billingPeriod,
        min_quantity: minQtyNum,
        valid_from: validFrom,
        valid_to: validTo || null,
        auto_close: autoClose,
        closable,
        pausable,
        renewable,
        is_active: isActive,
      };

      if (editingPlan) {
        const updated = await apiRequest<Plan>(`/plans/${editingPlan.id}`, {
          method: 'PATCH',
          body: payload,
        });
        setPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        showToast(`Saved plan "${updated.name}"`, 'success');
      } else {
        const created = await apiRequest<Plan>('/plans', {
          method: 'POST',
          body: payload,
        });
        setPlans((prev) => [created, ...prev]);
        showToast(`Created plan "${created.name}"`, 'success');
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

  const visiblePlans = plans.filter((p) => !periodFilter || p.billing_period === periodFilter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">
            Recurring Cadence &amp; State Rules · {isAdmin ? 'Admin Write' : 'Staff Read-Only'}
          </span>
          <h1 className="type-display-md">Subscription Plans &amp; Behavior Flags</h1>
          <p className="type-caption">
            Plan flags directly gate whether Pause, Close, and Renew buttons appear on active subscriptions.
          </p>
        </div>

        <div className="page-header-actions">
          <select
            className="form-select"
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value)}
            style={{ width: 170 }}
            aria-label="Filter by billing period"
          >
            <option value="">All Intervals</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>

          {isAdmin ? (
            <Button variant="primary" onClick={openCreate}>
              <Plus size={15} />
              New Plan
            </Button>
          ) : (
            <StatusChip status="Read-Only Access" variant="neutral" />
          )}
        </div>
      </header>

      {/* Quick Billing Cadence Segmented Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <SegmentedTabs
          ariaLabel="Billing interval quick filter"
          value={periodFilter}
          onChange={setPeriodFilter}
          items={[
            { value: '', label: 'All Plans', count: plans.length },
            {
              value: 'monthly',
              label: 'Monthly',
              count: plans.filter((p) => p.billing_period === 'monthly').length,
            },
            {
              value: 'yearly',
              label: 'Yearly',
              count: plans.filter((p) => p.billing_period === 'yearly').length,
            },
            {
              value: 'weekly',
              label: 'Weekly',
              count: plans.filter((p) => p.billing_period === 'weekly').length,
            },
            {
              value: 'daily',
              label: 'Daily',
              count: plans.filter((p) => p.billing_period === 'daily').length,
            },
          ]}
        />
        <span className="type-caption">{visiblePlans.length} active or draft plans</span>
      </div>

      {isLoading ? (
        <div className="tile-mosaic-2x2">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="product-tile">
              <div className="skeleton-line" style={{ width: '40%', marginBottom: 14 }} />
              <div className="skeleton-line" style={{ width: '75%', marginBottom: 10 }} />
              <div className="skeleton-line" style={{ width: '60%' }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="tile-mosaic-2x2">
          {visiblePlans.map((plan) => {
            const mrrEq = normalizeToMonthlyMrr(plan.price, plan.billing_period);
            return (
              <article
                key={plan.id}
                className="product-tile"
                style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span className="eyebrow-cap">{plan.billing_period} cadence</span>
                      <StatusChip
                        status={plan.is_active ? 'Active' : 'Inactive'}
                        variant={plan.is_active ? 'active' : 'draft'}
                      />
                    </div>
                    <h2 className="type-heading">{plan.name}</h2>
                  </div>

                  {isAdmin ? (
                    <Button variant="outline" onClick={() => openEdit(plan)}>
                      <Pencil size={13} />
                      Configure
                    </Button>
                  ) : null}
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    padding: '14px 16px',
                    borderRadius: 'var(--rounded-md)',
                    backgroundColor: 'var(--color-canvas-sand)',
                    border: '1px solid var(--color-hairline)',
                  }}
                >
                  <div>
                    <div className="type-display-md">{formatMoney(plan.price, currency)}</div>
                    <span className="type-caption">
                      per {plan.billing_period} · Normalized MRR: {formatMoney(mrrEq, currency)}/mo
                    </span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className="eyebrow-cap">Min Qty</span>
                    <div className="type-heading">{plan.min_quantity}</div>
                  </div>
                </div>

                <div className="type-caption" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Valid from: {formatDate(plan.valid_from)}</span>
                  <span>Valid until: {plan.valid_to ? formatDate(plan.valid_to) : 'Evergreen'}</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <ToggleSwitch
                    label="Pausable"
                    description="Enables Pause button"
                    checked={plan.pausable}
                    disabled={!isAdmin}
                    onChange={(v) => void handleToggleFlag(plan, 'pausable', v)}
                  />
                  <ToggleSwitch
                    label="Closable"
                    description="Enables Close button"
                    checked={plan.closable}
                    disabled={!isAdmin}
                    onChange={(v) => void handleToggleFlag(plan, 'closable', v)}
                  />
                  <ToggleSwitch
                    label="Renewable"
                    description="Enables Renew button"
                    checked={plan.renewable}
                    disabled={!isAdmin}
                    onChange={(v) => void handleToggleFlag(plan, 'renewable', v)}
                  />
                  <ToggleSwitch
                    label="Auto-Close"
                    description="Closes on expiry"
                    checked={plan.auto_close}
                    disabled={!isAdmin}
                    onChange={(v) => void handleToggleFlag(plan, 'auto_close', v)}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        title={editingPlan ? `Configure ${editingPlan.name}` : 'Create Subscription Plan'}
        eyebrow="Plan Terms & Lifecycle Flags"
        onClose={() => setIsModalOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSavePlan} isLoading={isSaving}>
              {editingPlan ? 'Save Plan' : 'Create Plan'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSavePlan} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormInput
            label="Plan Name"
            placeholder="Growth Monthly"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={formErrors.name}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <FormInput
              label={`Base Price (${currency})`}
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              error={formErrors.price}
            />
            <FormSelect
              label="Billing Period"
              value={billingPeriod}
              onChange={(e) => setBillingPeriod(e.target.value as BillingPeriod)}
              options={[
                { value: 'daily', label: 'Daily' },
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
                { value: 'yearly', label: 'Yearly' },
              ]}
            />
            <FormInput
              label="Minimum Quantity"
              type="number"
              min="1"
              step="1"
              value={minQuantity}
              onChange={(e) => setMinQuantity(e.target.value)}
              error={formErrors.min_quantity}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FormInput
              label="Valid From"
              type="date"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
              error={formErrors.valid_from}
            />
            <FormInput
              label="Valid To (Optional)"
              type="date"
              value={validTo}
              onChange={(e) => setValidTo(e.target.value)}
              error={formErrors.valid_to}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ToggleSwitch label="Plan Active in New Quotations" checked={isActive} onChange={setIsActive} />
            <ToggleSwitch label="Pausable (Shows Pause action on Active subscriptions)" checked={pausable} onChange={setPausable} />
            <ToggleSwitch label="Closable (Shows Close action on Active subscriptions)" checked={closable} onChange={setClosable} />
            <ToggleSwitch label="Renewable (Shows Renew action on Closed subscriptions)" checked={renewable} onChange={setRenewable} />
            <ToggleSwitch label="Auto-Close on Term Expiry" checked={autoClose} onChange={setAutoClose} />
          </div>
        </form>
      </Modal>
    </div>
  );
};

