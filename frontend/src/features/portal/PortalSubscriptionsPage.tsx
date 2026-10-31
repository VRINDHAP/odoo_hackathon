import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Sliders,
  XCircle,
} from 'lucide-react';
import { apiRequest, ApiClientError } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import {
  Button,
  FormInput,
  FormSelect,
  FormTextarea,
  LifecycleStepper,
  Modal,
  ToggleSwitch,
} from '../../components/forms/Primitives';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { useToast } from '../../hooks/useToast';
import type { Plan, Product, Subscription, TaxRule } from '../../types/domain';
import { formatDate, formatDateTime, todayIsoDate } from '../../utils/dates';
import { formatMoney, parseMoney, roundHalfUp } from '../../utils/money';

type PortalRequestType = 'upgrade' | 'pause' | 'cancel';

interface PortalRequestResponse {
  message: string;
  subscription: Subscription;
}

interface PortalCatalogResponse {
  plans: Plan[];
  products: Product[];
  taxes: TaxRule[];
  currency: string;
}

/**
 * FE-7.1: Customer Portal "My Subscriptions" [SPEC.md §2, §6.1, §9, §12.3 & PDF pp. 1–2]
 * - Strictly queries GET /me/subscriptions (customer data isolation)
 * - Displays active plan card, status chip, lifecycle stepper, start, expiry & next billing dates
 * - Allows confirming open Quotations (/me/subscriptions/{id}/confirm)
 * - Self-service Add-on Toggles: switch optional add-ons ON and OFF anytime (/me/subscriptions/{id}/addons)
 * - Self-service Plan Lifecycle controls (Pause / Resume / Close / Renew) gated by plan flags
 * - Self-service "Browse Plans & Subscribe" modal (/me/subscriptions) + tracked Upgrade/Pause/Cancel requests
 */
export const PortalSubscriptionsPage: React.FC = () => {
  const { showToast } = useToast();

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [catalog, setCatalog] = useState<PortalCatalogResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [togglingAddonKey, setTogglingAddonKey] = useState<string | null>(null);
  const [mutatingSubId, setMutatingSubId] = useState<string | null>(null);

  // Self-service Browse Plans & Subscribe modal
  const [isSubscribeOpen, setIsSubscribeOpen] = useState(false);
  const [subPlanId, setSubPlanId] = useState('');
  const [subProductId, setSubProductId] = useState('');
  const [subVariantId, setSubVariantId] = useState('');
  const [subQuantity, setSubQuantity] = useState('5');
  const [subCoupon, setSubCoupon] = useState('');
  const [subscribeError, setSubscribeError] = useState('');
  const [isSubscribing, setIsSubscribing] = useState(false);

  // Self-service tracked request modal
  const [requestTarget, setRequestTarget] = useState<Subscription | null>(null);
  const [requestType, setRequestType] = useState<PortalRequestType>('upgrade');
  const [requestNote, setRequestNote] = useState('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);

  const loadMySubscriptions = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      try {
        const [subsData, catalogData] = await Promise.all([
          apiRequest<Subscription[]>('/me/subscriptions'),
          apiRequest<PortalCatalogResponse>('/me/catalog').catch(() => null),
        ]);
        setSubscriptions(subsData);
        if (catalogData) {
          setCatalog(catalogData);
          if (catalogData.plans[0]) {
            const firstPlan = catalogData.plans[0];
            setSubPlanId((prev) => {
              if (!prev) setSubQuantity(String(firstPlan.min_quantity));
              return prev || firstPlan.id;
            });
          }
          const coreProds = catalogData.products.filter((p) => p.type !== 'addon');
          const defaultProd = coreProds[0] ?? catalogData.products[0];
          if (defaultProd) {
            setSubProductId((prev) => prev || defaultProd.id);
          }
        }
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : 'Unable to load your subscriptions',
          'error'
        );
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    void loadMySubscriptions(false);
  }, [loadMySubscriptions]);

  const syncSubscriptionsSilently = useCallback(() => {
    void loadMySubscriptions(true);
  }, [loadMySubscriptions]);

  useRealtimeSync(syncSubscriptionsSilently, { pollIntervalMs: 30000 });

  const addonProducts = useMemo(
    () => (catalog?.products ?? []).filter((p) => p.type === 'addon'),
    [catalog?.products]
  );

  const planById = useCallback(
    (planId: string): Plan | undefined => catalog?.plans.find((p) => p.id === planId),
    [catalog?.plans]
  );

  const handleConfirmQuotation = async (sub: Subscription) => {
    if (sub.quote_valid_until && todayIsoDate() > sub.quote_valid_until) {
      showToast(`This quotation expired on ${formatDate(sub.quote_valid_until)}.`, 'error');
      return;
    }
    setConfirmingId(sub.id);
    try {
      const updated = await apiRequest<Subscription>(
        `/me/subscriptions/${sub.id}/confirm`,
        { method: 'POST' }
      );
      setSubscriptions((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item))
      );
      showToast(`Quotation ${sub.number} confirmed.`, 'success');
    } catch (err) {
      showToast(
        err instanceof ApiClientError ? err.message : 'Failed to confirm quotation',
        'error'
      );
    } finally {
      setConfirmingId(null);
    }
  };

  const handleToggleAddon = async (sub: Subscription, addon: Product, enabled: boolean) => {
    const key = `${sub.id}:${addon.id}`;
    setTogglingAddonKey(key);
    try {
      const updated = await apiRequest<Subscription>(
        `/me/subscriptions/${sub.id}/addons`,
        {
          method: 'POST',
          body: { product_id: addon.id, enabled },
        }
      );
      setSubscriptions((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item))
      );
      showToast(
        enabled
          ? `Switched ON "${addon.name}" on ${sub.number}`
          : `Switched OFF "${addon.name}" on ${sub.number}`,
        'success'
      );
    } catch (err) {
      showToast(
        err instanceof ApiClientError ? err.message : 'Could not update add-on',
        'error'
      );
    } finally {
      setTogglingAddonKey(null);
    }
  };

  const handleSelfServiceAction = async (
    sub: Subscription,
    action: 'pause' | 'resume' | 'close' | 'renew'
  ) => {
    setMutatingSubId(sub.id);
    try {
      const updated = await apiRequest<Subscription>(
        `/me/subscriptions/${sub.id}/${action}`,
        {
          method: 'POST',
          body:
            action === 'close'
              ? { close_reason: 'Closed directly by customer via self-service portal.' }
              : undefined,
        }
      );
      setSubscriptions((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item))
      );
      const verb =
        action === 'pause'
          ? 'paused'
          : action === 'resume'
          ? 'resumed'
          : action === 'close'
          ? 'closed'
          : 'renewed';
      showToast(`Subscription ${sub.number} ${verb}.`, 'success');
    } catch (err) {
      showToast(
        err instanceof ApiClientError ? err.message : `Unable to ${action} subscription`,
        'error'
      );
    } finally {
      setMutatingSubId(null);
    }
  };

  const selectedSubPlan = catalog?.plans.find((p) => p.id === subPlanId);
  const selectedSubProduct = catalog?.products.find((p) => p.id === subProductId);
  const selectedSubVariant = selectedSubProduct?.variants.find((v) => v.id === subVariantId);

  const estimatedNewTotal = useMemo(() => {
    if (!selectedSubProduct) return 0;
    const qty = Math.max(1, Number.parseInt(subQuantity, 10) || 1);
    const unit = roundHalfUp(
      parseMoney(selectedSubProduct.sales_price) +
        (selectedSubVariant ? parseMoney(selectedSubVariant.extra_price) : 0)
    );
    const subTot = roundHalfUp(qty * unit);
    const taxRule = catalog?.taxes.find((t) => t.id === selectedSubProduct.tax_id);
    const taxRate = taxRule ? parseMoney(taxRule.rate) : 18;
    const taxAmt = taxRule?.inclusive ? 0 : roundHalfUp((subTot * taxRate) / 100);
    return roundHalfUp(subTot + taxAmt);
  }, [catalog?.taxes, selectedSubProduct, selectedSubVariant, subQuantity]);

  const handleSelfSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    const minQty = selectedSubPlan?.min_quantity ?? 1;
    const qtyNum = Number.parseInt(subQuantity, 10);
    if (!subPlanId || !subProductId) {
      setSubscribeError('Please choose both a billing plan and a product.');
      return;
    }
    if (Number.isNaN(qtyNum) || qtyNum < minQty) {
      setSubscribeError(`Minimum quantity for ${selectedSubPlan?.name ?? 'this plan'} is ${minQty}.`);
      return;
    }

    setSubscribeError('');
    setIsSubscribing(true);
    try {
      const created = await apiRequest<Subscription>('/me/subscriptions', {
        method: 'POST',
        body: {
          plan_id: subPlanId,
          product_id: subProductId,
          variant_id: subVariantId || null,
          quantity: qtyNum,
          coupon_code: subCoupon.trim() || null,
        },
      });
      setSubscriptions((prev) => [created, ...prev]);
      setIsSubscribeOpen(false);
      setSubCoupon('');
      showToast(`Subscribed to ${created.plan_name} (${created.number})`, 'success');
    } catch (err) {
      setSubscribeError(
        err instanceof ApiClientError ? err.message : 'Unable to start subscription'
      );
    } finally {
      setIsSubscribing(false);
    }
  };

  const openRequestModal = (sub: Subscription, type: PortalRequestType) => {
    setRequestTarget(sub);
    setRequestType(type);
    setRequestNote('');
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestTarget) return;

    setIsSubmittingRequest(true);
    try {
      const res = await apiRequest<PortalRequestResponse>(
        `/me/subscriptions/${requestTarget.id}/request`,
        {
          method: 'POST',
          body: {
            request_type: requestType,
            note: requestNote.trim(),
          },
        }
      );
      setSubscriptions((prev) =>
        prev.map((item) =>
          item.id === res.subscription.id ? res.subscription : item
        )
      );
      showToast(res.message, 'success');
      setRequestTarget(null);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to submit portal request',
        'error'
      );
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">Self-Service Subscription Center</span>
          <h1 className="type-display-md">My Subscriptions</h1>
          <p className="type-caption">
            View and manage your subscriptions, switch optional add-ons on or off, confirm quotes, and renew or pause plans without emailing support.
          </p>
        </div>

        {catalog && catalog.plans.length > 0 ? (
          <div className="page-header-actions">
            <Button variant="primary" onClick={() => setIsSubscribeOpen(true)}>
              <Plus size={15} />
              Browse Plans &amp; Subscribe
            </Button>
          </div>
        ) : null}
      </header>

      {isLoading ? (
        <div className="product-tile" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="skeleton-line" style={{ width: '35%' }} />
          <div className="skeleton-line" style={{ width: '70%' }} />
          <div className="skeleton-line" style={{ width: '50%' }} />
        </div>
      ) : subscriptions.length === 0 ? (
        <div className="product-tile">
          <span className="eyebrow-cap">No Active Plans</span>
          <h2 className="type-heading" style={{ marginTop: 6 }}>
            You don&apos;t have any subscriptions yet
          </h2>
          <p className="type-caption" style={{ marginTop: 4 }}>
            Start a new plan directly below or confirm a quotation sent by your account team.
          </p>
          {catalog && catalog.plans.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <Button variant="primary" onClick={() => setIsSubscribeOpen(true)}>
                <Plus size={14} />
                Browse Plans &amp; Subscribe
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        subscriptions.map((sub) => {
          const plan = planById(sub.plan_id);
          const canManageAddons =
            addonProducts.length > 0 &&
            (sub.status === 'active' || sub.status === 'confirmed');

          return (
            <article
              key={sub.id}
              className={`product-tile ${
                sub.status === 'active' ? 'surface-SolarWarmth' : ''
              }`.trim()}
              style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
            >
              {/* Top Plan Card Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: 16,
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="mono-text">{sub.number}</span>
                    <StatusChip status={sub.status} />
                    {sub.discount_name ? (
                      <StatusChip status={sub.discount_name} variant="active" />
                    ) : null}
                  </div>
                  <h2 className="type-heading" style={{ marginTop: 8 }}>
                    {sub.plan_name}
                  </h2>
                  <p className="type-caption" style={{ textTransform: 'capitalize' }}>
                    {sub.billing_period} cadence · Terms: {sub.payment_terms} · Billing anchor day{' '}
                    {sub.anchor_day}
                  </p>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <span className="eyebrow-cap">Recurring Total</span>
                  <div className="type-stat-sm cell-numeric" style={{ marginTop: 4 }}>
                    {formatMoney(sub.total, sub.currency)}
                  </div>
                  <span className="type-caption">
                    Next Billing: {formatDate(sub.next_billing_date)}
                  </span>
                </div>
              </div>

              {/* Lifecycle Stepper */}
              <LifecycleStepper
                steps={['Draft', 'Quotation', 'Confirmed', 'Active', 'Closed']}
                currentStatus={sub.status}
                branchStatus={
                  sub.status === 'paused'
                    ? 'Paused'
                    : sub.status === 'cancelled'
                    ? 'Cancelled'
                    : null
                }
              />

              {/* Key Dates Grid */}
              <div
                className="mosaic-grid-4"
                style={{
                  padding: 14,
                  borderRadius: 'var(--rounded-md)',
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-hairline)',
                }}
              >
                <div>
                  <span className="eyebrow-cap">Start Date</span>
                  <div className="type-body-sm" style={{ marginTop: 4 }}>
                    {formatDate(sub.start_date)}
                  </div>
                </div>
                <div>
                  <span className="eyebrow-cap">Next Billing Date</span>
                  <div className="type-body-sm" style={{ marginTop: 4 }}>
                    {formatDate(sub.next_billing_date)}
                  </div>
                </div>
                <div>
                  <span className="eyebrow-cap">Term Expiry</span>
                  <div className="type-body-sm" style={{ marginTop: 4 }}>
                    {formatDate(sub.expiry_date)}
                  </div>
                </div>
                <div>
                  <span className="eyebrow-cap">Subtotal / Tax</span>
                  <div
                    className="type-body-sm cell-numeric"
                    style={{ textAlign: 'left', marginTop: 4 }}
                  >
                    {formatMoney(sub.subtotal, sub.currency)} +{' '}
                    {formatMoney(sub.tax_total, sub.currency)}
                  </div>
                </div>
              </div>

              {/* Included Line Items */}
              <div className="data-table-shell">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Included Product / Service</th>
                      <th className="col-right">Qty</th>
                      <th className="col-right">Unit Price</th>
                      <th className="col-right">Tax</th>
                      <th className="col-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sub.lines.map((line) => (
                      <tr key={line.id}>
                        <td>
                          <div>{line.product_name}</div>
                          {line.variant_label ? (
                            <div className="type-caption">{line.variant_label}</div>
                          ) : null}
                        </td>
                        <td className="cell-numeric">{line.quantity}</td>
                        <td className="cell-numeric">
                          {formatMoney(line.unit_price, sub.currency)}
                        </td>
                        <td className="cell-numeric">
                          {formatMoney(line.line_tax, sub.currency)}
                        </td>
                        <td className="cell-numeric">
                          {formatMoney(line.line_total, sub.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* PDF p. 1: Optional Add-ons Customers Switch On and Off */}
              {canManageAddons ? (
                <div
                  style={{
                    padding: 16,
                    borderRadius: 'var(--rounded-md)',
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-hairline)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <Sliders size={14} />
                      <span className="eyebrow-cap">
                        Optional Add-Ons — Switch On &amp; Off Anytime
                      </span>
                    </div>
                    <span className="type-caption">
                      Changes update your recurring plan total immediately
                    </span>
                  </div>

                  <div className="mosaic-grid-2">
                    {addonProducts.map((addon) => {
                      const isEnabled = sub.lines.some((ln) => ln.product_id === addon.id);
                      const isBusy = togglingAddonKey === `${sub.id}:${addon.id}`;
                      return (
                        <ToggleSwitch
                          key={addon.id}
                          label={`${addon.name} (+${formatMoney(addon.sales_price, sub.currency)})`}
                          description={addon.notes || 'Instant self-service module activation'}
                          checked={isEnabled}
                          disabled={isBusy}
                          onChange={(nextVal) =>
                            void handleToggleAddon(sub, addon, nextVal)
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Customer Self-Service Actions (Plan-Flag Aware + Zero Admin Controls Exposed) */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                  paddingTop: 8,
                  borderTop: '1px solid var(--color-hairline)',
                }}
              >
                <span className="type-caption">
                  Latest update:{' '}
                  {sub.activities[0]
                    ? `${sub.activities[0].action} (${formatDateTime(sub.activities[0].timestamp)})`
                    : 'Active'}
                </span>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {sub.status === 'quotation' ? (
                    <Button
                      variant="primary"
                      isLoading={confirmingId === sub.id}
                      onClick={() => void handleConfirmQuotation(sub)}
                    >
                      <CheckCircle2 size={14} />
                      Confirm Quotation
                    </Button>
                  ) : null}

                  {sub.status === 'active' ? (
                    <>
                      <Button
                        variant="primary"
                        onClick={() => openRequestModal(sub, 'upgrade')}
                      >
                        <ArrowUpRight size={14} />
                        Request Upgrade
                      </Button>

                      {plan?.pausable ? (
                        <Button
                          variant="outline"
                          isLoading={mutatingSubId === sub.id}
                          onClick={() => void handleSelfServiceAction(sub, 'pause')}
                        >
                          <PauseCircle size={14} />
                          Pause Plan
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() => openRequestModal(sub, 'pause')}
                        >
                          <PauseCircle size={14} />
                          Request Pause
                        </Button>
                      )}

                      {plan?.closable ? (
                        <Button
                          variant="sand"
                          isLoading={mutatingSubId === sub.id}
                          onClick={() => void handleSelfServiceAction(sub, 'close')}
                        >
                          <XCircle size={14} />
                          Close Plan
                        </Button>
                      ) : (
                        <Button
                          variant="sand"
                          onClick={() => openRequestModal(sub, 'cancel')}
                        >
                          <XCircle size={14} />
                          Request Cancellation
                        </Button>
                      )}
                    </>
                  ) : null}

                  {sub.status === 'paused' ? (
                    <>
                      <Button
                        variant="primary"
                        isLoading={mutatingSubId === sub.id}
                        onClick={() => void handleSelfServiceAction(sub, 'resume')}
                      >
                        <PlayCircle size={14} />
                        Resume Plan
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => openRequestModal(sub, 'upgrade')}
                      >
                        <ArrowUpRight size={14} />
                        Request Upgrade
                      </Button>
                      {plan?.closable ? (
                        <Button
                          variant="sand"
                          isLoading={mutatingSubId === sub.id}
                          onClick={() => void handleSelfServiceAction(sub, 'close')}
                        >
                          <XCircle size={14} />
                          Close Plan
                        </Button>
                      ) : (
                        <Button
                          variant="sand"
                          onClick={() => openRequestModal(sub, 'cancel')}
                        >
                          <XCircle size={14} />
                          Request Cancellation
                        </Button>
                      )}
                    </>
                  ) : null}

                  {sub.status === 'closed' && (plan?.renewable ?? true) ? (
                    <Button
                      variant="primary"
                      isLoading={mutatingSubId === sub.id}
                      onClick={() => void handleSelfServiceAction(sub, 'renew')}
                    >
                      <RefreshCw size={14} />
                      Renew Subscription
                    </Button>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })
      )}

      {/* Self-Service Browse Plans & Subscribe Modal */}
      <Modal
        isOpen={isSubscribeOpen}
        eyebrow="Instant Self-Service Activation"
        title="Start a New Subscription"
        onClose={() => setIsSubscribeOpen(false)}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setIsSubscribeOpen(false)}
              disabled={isSubscribing}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="portal-new-sub-form"
              isLoading={isSubscribing}
            >
              Start Subscription →
            </Button>
          </>
        }
      >
        <form
          id="portal-new-sub-form"
          onSubmit={(e) => void handleSelfSubscribe(e)}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          {subscribeError ? <div className="form-error-text">{subscribeError}</div> : null}

          <FormSelect
            label="Billing Plan & Cadence"
            value={subPlanId}
            onChange={(e) => {
              const pid = e.target.value;
              setSubPlanId(pid);
              const found = catalog?.plans.find((p) => p.id === pid);
              if (found) setSubQuantity(String(found.min_quantity));
            }}
            options={(catalog?.plans ?? []).map((p) => ({
              value: p.id,
              label: `${p.name} — ${p.billing_period} (Min ${p.min_quantity} seats)`,
            }))}
          />

          <FormSelect
            label="Software / Service Product"
            value={subProductId}
            onChange={(e) => {
              setSubProductId(e.target.value);
              setSubVariantId('');
            }}
            options={(catalog?.products ?? []).map((p) => ({
              value: p.id,
              label: `${p.name} (${formatMoney(p.sales_price, catalog?.currency ?? 'INR')})`,
            }))}
          />

          {selectedSubProduct && selectedSubProduct.variants.length > 0 ? (
            <FormSelect
              label="Product Variant (Optional)"
              value={subVariantId}
              onChange={(e) => setSubVariantId(e.target.value)}
              options={[
                { value: '', label: 'Standard Base Edition (+0.00)' },
                ...selectedSubProduct.variants.map((v) => ({
                  value: v.id,
                  label: `${v.attribute}: ${v.value} (+${formatMoney(
                    v.extra_price,
                    catalog?.currency ?? 'INR'
                  )})`,
                })),
              ]}
            />
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormInput
              label={`Seats / Units (Min ${selectedSubPlan?.min_quantity ?? 1})`}
              type="number"
              min={selectedSubPlan?.min_quantity ?? 1}
              value={subQuantity}
              onChange={(e) => setSubQuantity(e.target.value)}
            />
            <FormInput
              label="Promo Code (Optional)"
              placeholder="SCALE15"
              value={subCoupon}
              onChange={(e) => setSubCoupon(e.target.value.toUpperCase())}
            />
          </div>

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
            <span className="type-caption">Estimated Recurring Total (incl. GST)</span>
            <span className="money-cell">
              {formatMoney(estimatedNewTotal, catalog?.currency ?? 'INR')}
            </span>
          </div>
        </form>
      </Modal>

      {/* Self-Service Tracked Request Modal */}
      <Modal
        isOpen={Boolean(requestTarget)}
        eyebrow="Tracked Subscription Request"
        title={`Request ${
          requestType === 'upgrade'
            ? 'Plan Upgrade'
            : requestType === 'pause'
            ? 'Temporary Pause'
            : 'Subscription Cancellation'
        }`}
        onClose={() => setRequestTarget(null)}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setRequestTarget(null)}
              disabled={isSubmittingRequest}
            >
              Keep Current Plan
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="portal-sub-request-form"
              isLoading={isSubmittingRequest}
            >
              Submit Request
            </Button>
          </>
        }
      >
        <form
          id="portal-sub-request-form"
          onSubmit={(e) => void handleSubmitRequest(e)}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <p className="type-caption">
            Submitting this request notifies our billing operations team for{' '}
            <strong style={{ fontWeight: 400, color: 'var(--color-ink)' }}>
              {requestTarget?.number} ({requestTarget?.plan_name})
            </strong>{' '}
            and logs a timestamped entry on your subscription record.
          </p>

          <FormTextarea
            label="Details / Preferred Effective Date"
            placeholder={
              requestType === 'upgrade'
                ? 'e.g. Add 15 additional seats starting next cycle...'
                : requestType === 'pause'
                ? 'e.g. Pause billing for 30 days during seasonal closure...'
                : 'Please share the reason for cancellation...'
            }
            value={requestNote}
            onChange={(e) => setRequestNote(e.target.value)}
          />
        </form>
      </Modal>
    </div>
  );
};
