import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  XCircle,
} from 'lucide-react';
import { apiRequest, ApiClientError } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import {
  Button,
  ConfirmModal,
  FormSelect,
  FormTextarea,
  LifecycleStepper,
  Modal,
} from '../../components/forms/Primitives';
import { useToast } from '../../hooks/useToast';
import type {
  DiscountRule,
  Plan,
  Product,
  Subscription,
  SubscriptionLine,
  TaxRule,
} from '../../types/domain';
import { formatDate, formatDateTime, todayIsoDate } from '../../utils/dates';
import { formatMoney, parseMoney, roundHalfUp, toFixedMoney } from '../../utils/money';

/**
 * FE-3.4 & FE-3.5: Subscription Detail, Lifecycle Stepper, Live Draft Line Editor
 * & Plan-Flag-Gated Transitions [SPEC.md §5.4, §5.6, §6.1, §7.1, §12.2, §16, §18]
 */
export const SubscriptionDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { showToast } = useToast();

  const [sub, setSub] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [taxes, setTaxes] = useState<TaxRule[]>([]);
  const [discounts, setDiscounts] = useState<DiscountRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Live Draft Editor State
  const [draftLines, setDraftLines] = useState<SubscriptionLine[]>([]);
  const [couponInput, setCouponInput] = useState('');
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  // Lifecycle Transition Modals
  const [isMutatingState, setIsMutatingState] = useState(false);
  const [pauseConfirmOpen, setPauseConfirmOpen] = useState(false);
  const [activateConfirmOpen, setActivateConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [closeReasonError, setCloseReasonError] = useState('');
  const [prorationOpen, setProrationOpen] = useState(false);
  const [targetUpgradePlanId, setTargetUpgradePlanId] = useState('');

  const loadSubscription = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const [subData, planList, prodList, taxList, discList] = await Promise.all([
        apiRequest<Subscription>(`/subscriptions/${id}`),
        apiRequest<Plan[]>('/plans'),
        apiRequest<Product[]>('/products'),
        apiRequest<TaxRule[]>('/taxes'),
        apiRequest<DiscountRule[]>('/discounts').catch(() => [] as DiscountRule[]),
      ]);
      setSub(subData);
      setDraftLines(subData.lines);
      setCouponInput(subData.coupon_code ?? '');
      setPlans(planList);
      setProducts(prodList);
      setTaxes(taxList);
      setDiscounts(discList);
      if (planList[0]) setTargetUpgradePlanId(planList[0].id);
    } catch {
      showToast('Subscription not found', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => {
    void loadSubscription();
  }, [loadSubscription]);

  const currentPlan = useMemo(
    () => plans.find((p) => p.id === sub?.plan_id) ?? null,
    [plans, sub?.plan_id]
  );

  const minQtyRequired = currentPlan?.min_quantity ?? 1;
  const isDraft = sub?.status === 'draft';

  // Live Real-Time Calculation in Draft Mode (SPEC.md §7.1, §12.4)
  const livePricing = useMemo(() => {
    const sourceLines = isDraft ? draftLines : sub?.lines ?? [];
    let subtotal = 0;
    let taxTotal = 0;
    let hasInvalidLine = false;

    const computedLines = sourceLines.map((line) => {
      const qty = line.quantity;
      const unit = parseMoney(line.unit_price);
      if (qty < minQtyRequired || unit < 0) {
        hasInvalidLine = true;
      }
      const safeQty = Math.max(0, qty);
      const safeUnit = Math.max(0, unit);
      const rate = parseMoney(line.tax_rate);
      const rawSub = roundHalfUp(safeQty * safeUnit);
      let lineSub = rawSub;
      let lineTax = 0;
      if (line.tax_inclusive && rate > 0) {
        const base = roundHalfUp(rawSub / (1 + rate / 100));
        lineTax = roundHalfUp(rawSub - base);
        lineSub = base;
      } else if (rate > 0) {
        lineTax = roundHalfUp((rawSub * rate) / 100);
      }
      const lineTotal = roundHalfUp(lineSub + lineTax);
      subtotal = roundHalfUp(subtotal + lineSub);
      taxTotal = roundHalfUp(taxTotal + lineTax);
      return {
        ...line,
        line_subtotal: toFixedMoney(lineSub),
        line_tax: toFixedMoney(lineTax),
        line_total: toFixedMoney(lineTotal),
      };
    });

    // Evaluate best eligible discount preview (SPEC.md §7.3)
    let bestDiscountAmt = isDraft ? 0 : parseMoney(sub?.discount_total);
    let activeDiscountLabel = sub?.discount_name ?? null;

    if (isDraft && discounts.length > 0) {
      for (const d of discounts) {
        if (!d.is_active) continue;
        if (couponInput && d.code && d.code !== couponInput.trim().toUpperCase()) continue;
        if (subtotal < parseMoney(d.min_purchase_amount)) continue;
        const candidate =
          d.type === 'percent'
            ? roundHalfUp((subtotal * parseMoney(d.value)) / 100)
            : Math.min(subtotal, parseMoney(d.value));
        if (candidate > bestDiscountAmt) {
          bestDiscountAmt = candidate;
          activeDiscountLabel = d.name;
        }
      }
    }

    const exactTotal = roundHalfUp(subtotal - bestDiscountAmt + taxTotal);
    return {
      lines: computedLines,
      subtotal: toFixedMoney(subtotal),
      discountTotal: toFixedMoney(bestDiscountAmt),
      discountLabel: activeDiscountLabel,
      taxTotal: toFixedMoney(taxTotal),
      total: toFixedMoney(exactTotal),
      hasInvalidLine,
    };
  }, [couponInput, discounts, draftLines, isDraft, minQtyRequired, sub]);

  const addDraftLine = () => {
    const prod = products[0];
    if (!prod) return;
    const defaultTax = taxes.find((t) => t.id === prod.tax_id) ?? taxes[0];
    setDraftLines((prev) => [
      ...prev,
      {
        id: `sline-${Date.now()}-${prev.length}`,
        product_id: prod.id,
        product_name: prod.name,
        variant_id: null,
        variant_label: null,
        quantity: minQtyRequired,
        unit_price: prod.sales_price,
        tax_rate: defaultTax?.rate ?? '18.00',
        tax_inclusive: defaultTax?.inclusive ?? false,
        line_subtotal: '0.00',
        line_tax: '0.00',
        line_total: '0.00',
      },
    ]);
  };

  const handleSaveDraft = async (): Promise<boolean> => {
    if (!sub) return false;
    if (draftLines.length === 0) {
      showToast('Subscription must contain at least 1 line item.', 'error');
      return false;
    }
    if (livePricing.hasInvalidLine) {
      showToast(
        `Fix line errors first: quantities must be >= ${minQtyRequired} and unit prices >= 0.00.`,
        'error'
      );
      return false;
    }

    setIsSavingDraft(true);
    try {
      const updated = await apiRequest<Subscription>(`/subscriptions/${sub.id}`, {
        method: 'PATCH',
        body: {
          lines: livePricing.lines,
          discount_total: livePricing.discountTotal,
          discount_name: livePricing.discountLabel,
          coupon_code: couponInput.trim() || null,
        },
      });
      setSub(updated);
      setDraftLines(updated.lines);
      showToast('Saved Draft line items and totals', 'success');
      return true;
    } catch (err) {
      showToast(err instanceof ApiClientError ? err.message : 'Save failed', 'error');
      return false;
    } finally {
      setIsSavingDraft(false);
    }
  };

  const dispatchTransition = async (target: Subscription['status']) => {
    if (!sub) return;

    // Frontend Validation Before Dispatch (SPEC.md §6.1 Table)
    if (sub.status === 'draft' && target === 'quotation') {
      const saved = await handleSaveDraft();
      if (!saved) return;
    }

    if (sub.status === 'quotation' && target === 'confirmed') {
      if (sub.quote_valid_until && todayIsoDate() > sub.quote_valid_until) {
        showToast(
          `Alert: Quotation expired on ${formatDate(sub.quote_valid_until)}. Extend validity or create a fresh quote.`,
          'error'
        );
        return;
      }
    }

    setIsMutatingState(true);
    try {
      const updated = await apiRequest<Subscription>(`/subscriptions/${sub.id}/transition`, {
        method: 'POST',
        body: { target },
      });
      setSub(updated);
      setDraftLines(updated.lines);
      setActivateConfirmOpen(false);
      setCancelConfirmOpen(false);
      showToast(`Subscription transitioned to ${updated.status.toUpperCase()}`, 'success');
    } catch (err) {
      showToast(
        err instanceof ApiClientError ? err.message : 'Transition rejected',
        'error'
      );
    } finally {
      setIsMutatingState(false);
    }
  };

  const handlePause = async () => {
    if (!sub) return;
    setIsMutatingState(true);
    try {
      const updated = await apiRequest<Subscription>(`/subscriptions/${sub.id}/pause`, {
        method: 'POST',
      });
      setSub(updated);
      setPauseConfirmOpen(false);
      showToast('Subscription paused. Billing runs will skip paused periods.', 'success');
    } catch (err) {
      showToast(err instanceof ApiClientError ? err.message : 'Pause failed', 'error');
    } finally {
      setIsMutatingState(false);
    }
  };

  const handleResume = async () => {
    if (!sub) return;
    setIsMutatingState(true);
    try {
      const updated = await apiRequest<Subscription>(`/subscriptions/${sub.id}/resume`, {
        method: 'POST',
      });
      setSub(updated);
      showToast(
        `Subscription resumed. Next billing date recomputed to ${formatDate(updated.next_billing_date)}.`,
        'success'
      );
    } catch (err) {
      showToast(err instanceof ApiClientError ? err.message : 'Resume failed', 'error');
    } finally {
      setIsMutatingState(false);
    }
  };

  const handleCloseSub = async () => {
    if (!sub) return;
    if (!closeReason.trim()) {
      setCloseReasonError('A closure reason is mandatory for audit compliance.');
      return;
    }
    setCloseReasonError('');
    setIsMutatingState(true);
    try {
      const updated = await apiRequest<Subscription>(`/subscriptions/${sub.id}/close`, {
        method: 'POST',
        body: { close_reason: closeReason.trim() },
      });
      setSub(updated);
      setCloseModalOpen(false);
      setCloseReason('');
      showToast('Subscription closed', 'success');
    } catch (err) {
      showToast(err instanceof ApiClientError ? err.message : 'Close failed', 'error');
    } finally {
      setIsMutatingState(false);
    }
  };

  const handleRenew = async () => {
    if (!sub) return;
    setIsMutatingState(true);
    try {
      const updated = await apiRequest<Subscription>(`/subscriptions/${sub.id}/renew`, {
        method: 'POST',
      });
      setSub(updated);
      showToast('Subscription renewed for a new billing term', 'success');
    } catch (err) {
      showToast(err instanceof ApiClientError ? err.message : 'Renew failed', 'error');
    } finally {
      setIsMutatingState(false);
    }
  };

  if (isLoading || !sub) {
    return (
      <div className="product-tile">
        <div className="skeleton-line" style={{ width: '35%', marginBottom: 12 }} />
        <div className="skeleton-line" style={{ width: '75%' }} />
      </div>
    );
  }

  const branchLabel =
    sub.status === 'paused' ? 'Paused' : sub.status === 'cancelled' ? 'Cancelled' : null;

  const upgradePlan = plans.find((p) => p.id === targetUpgradePlanId);
  const prorationDelta = upgradePlan
    ? roundHalfUp((parseMoney(upgradePlan.price) - parseMoney(currentPlan?.price)) * 0.5)
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <Link to="/subscriptions" className="type-caption" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={14} />
          Back to Subscriptions
        </Link>
      </div>

      {/* SPEC.md §16: Prominent Paused Subscription Banner */}
      {sub.status === 'paused' ? (
        <div
          role="alert"
          style={{
            padding: '14px 18px',
            borderRadius: 'var(--rounded-lg)',
            backgroundColor: 'var(--chip-paused-bg)',
            border: '1px solid var(--chip-paused-border)',
            color: 'var(--chip-paused-text)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={18} />
            <span>
              <strong>Paused: No billing runs will occur.</strong> Resuming will recompute the next billing date from the resume timestamp.
            </span>
          </div>
          <span className="type-caption" style={{ color: 'var(--chip-paused-text)' }}>
            Paused {formatDateTime(sub.paused_at)}
          </span>
        </div>
      ) : null}

      {/* Header & Lifecycle Actions (Gated by Plan Behavior Flags!) */}
      <header className="page-header">
        <div className="page-header-titles">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono-text">{sub.number}</span>
            <StatusChip status={sub.status} />
          </div>
          <h1 className="type-display-md">{sub.customer_name}</h1>
          <p className="type-caption">
            Plan: {sub.plan_name} ({sub.billing_period}) · Payment Terms: {sub.payment_terms} · Anchor Day: {sub.anchor_day}
          </p>
        </div>

        <div className="page-header-actions">
          {sub.status === 'draft' ? (
            <>
              <Button variant="outline" onClick={() => void handleSaveDraft()} isLoading={isSavingDraft}>
                <Save size={14} />
                Save Draft
              </Button>
              <Button
                variant="primary"
                onClick={() => void dispatchTransition('quotation')}
                disabled={livePricing.hasInvalidLine || draftLines.length === 0}
                isLoading={isMutatingState}
              >
                Send Quotation →
              </Button>
            </>
          ) : null}

          {sub.status === 'quotation' ? (
            <>
              <Button variant="danger" onClick={() => setCancelConfirmOpen(true)}>
                Cancel Quote
              </Button>
              <Button
                variant="primary"
                onClick={() => void dispatchTransition('confirmed')}
                isLoading={isMutatingState}
              >
                Confirm Order →
              </Button>
            </>
          ) : null}

          {sub.status === 'confirmed' ? (
            <>
              <Button variant="danger" onClick={() => setCancelConfirmOpen(true)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setActivateConfirmOpen(true)}>
                Activate Subscription →
              </Button>
            </>
          ) : null}

          {sub.status === 'active' ? (
            <>
              <Button variant="outline" onClick={() => setProrationOpen(true)}>
                <ArrowUpRight size={14} />
                Proration Preview
              </Button>
              {/* SPEC.md §5.4 & §6.1: Show Pause ONLY IF plan.pausable == true */}
              {currentPlan?.pausable ? (
                <Button variant="outline" onClick={() => setPauseConfirmOpen(true)}>
                  <PauseCircle size={14} />
                  Pause
                </Button>
              ) : null}
              {/* SPEC.md §5.4 & §6.1: Show Close ONLY IF plan.closable == true */}
              {currentPlan?.closable ? (
                <Button variant="danger" onClick={() => setCloseModalOpen(true)}>
                  <XCircle size={14} />
                  Close
                </Button>
              ) : null}
            </>
          ) : null}

          {sub.status === 'paused' ? (
            <>
              {currentPlan?.closable ? (
                <Button variant="danger" onClick={() => setCloseModalOpen(true)}>
                  <XCircle size={14} />
                  Close
                </Button>
              ) : null}
              <Button variant="primary" onClick={() => void handleResume()} isLoading={isMutatingState}>
                <PlayCircle size={14} />
                Resume Subscription
              </Button>
            </>
          ) : null}

          {/* SPEC.md §5.4 & §6.1: Show Renew ONLY IF plan.renewable == true */}
          {sub.status === 'closed' && currentPlan?.renewable ? (
            <Button variant="primary" onClick={() => void handleRenew()} isLoading={isMutatingState}>
              <RefreshCw size={14} />
              Renew Subscription
            </Button>
          ) : null}
        </div>
      </header>

      {/* Horizontal Lifecycle Stepper Card */}
      <section className="product-tile-compact" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <LifecycleStepper
            steps={['Draft', 'Quotation', 'Confirmed', 'Active', 'Closed']}
            currentStatus={sub.status}
            branchStatus={branchLabel}
          />
          <span className="type-caption">
            Min Plan Qty: <strong>{minQtyRequired}</strong> ·{' '}
            {currentPlan?.pausable ? 'Pausable' : 'Non-Pausable'} ·{' '}
            {currentPlan?.closable ? 'Closable' : 'Non-Closable'} ·{' '}
            {currentPlan?.renewable ? 'Renewable' : 'Non-Renewable'}
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            gap: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--color-hairline)',
          }}
        >
          <div>
            <span className="eyebrow-cap">Start Date</span>
            <div title={sub.start_date ? `${sub.start_date}T00:00:00Z` : undefined}>
              {formatDate(sub.start_date)}
            </div>
          </div>
          <div>
            <span className="eyebrow-cap">Next Billing</span>
            <div title={sub.next_billing_date ? `${sub.next_billing_date}T00:00:00Z` : undefined}>
              {formatDate(sub.next_billing_date)}
            </div>
          </div>
          <div>
            <span className="eyebrow-cap">Last Billed Through</span>
            <div>{formatDate(sub.last_billed_through)}</div>
          </div>
          <div>
            <span className="eyebrow-cap">Quote Valid Until</span>
            <div>{formatDate(sub.quote_valid_until)}</div>
          </div>
          <div>
            <span className="eyebrow-cap">Billing Anchor Day</span>
            <div>Day {sub.anchor_day} (Read-only)</div>
          </div>
        </div>
      </section>

      {/* Real-Time Line Item Editor (Editable in Draft, Snapshot Locked Otherwise) */}
      <section className="table-card">
        <div className="table-toolbar">
          <div>
            <span className="eyebrow-cap">
              {isDraft
                ? 'Live Draft Line Pricing Calculator (Editable)'
                : 'Contract Line Snapshot (Locked — Immune to Catalog Price Edits)'}
            </span>
          </div>
          {isDraft ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="text"
                className="form-input"
                placeholder="Coupon code (e.g. SCALE15)"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                style={{ width: 200 }}
                aria-label="Coupon code"
              />
              <Button variant="sand" onClick={addDraftLine}>
                <Plus size={14} />
                Add Line
              </Button>
            </div>
          ) : null}
        </div>

        <div className="table-scroll">
          <table className="ramp-table">
            <thead>
              <tr>
                <th>Product &amp; Variant</th>
                <th style={{ width: 130 }}>Quantity</th>
                <th style={{ width: 165, textAlign: 'right' }}>Unit Price ({sub.currency})</th>
                <th style={{ textAlign: 'right' }}>Tax Mode</th>
                <th style={{ textAlign: 'right' }}>Line Subtotal</th>
                <th style={{ textAlign: 'right' }}>Line Tax</th>
                <th style={{ textAlign: 'right' }}>Line Total</th>
                {isDraft ? <th style={{ width: 52 }} /> : null}
              </tr>
            </thead>
            <tbody>
              {livePricing.lines.map((line, index) => {
                const qtyBelowMin = isDraft && line.quantity < minQtyRequired;
                const negativeUnit = isDraft && parseMoney(line.unit_price) < 0;

                return (
                  <tr key={line.id}>
                    <td>
                      {isDraft ? (
                        <select
                          className="form-select"
                          value={line.product_id}
                          onChange={(e) => {
                            const prod = products.find((p) => p.id === e.target.value);
                            if (!prod) return;
                            const tax = taxes.find((t) => t.id === prod.tax_id) ?? taxes[0];
                            setDraftLines((prev) =>
                              prev.map((l, i) =>
                                i === index
                                  ? {
                                      ...l,
                                      product_id: prod.id,
                                      product_name: prod.name,
                                      variant_id: null,
                                      variant_label: null,
                                      unit_price: prod.sales_price,
                                      tax_rate: tax?.rate ?? '18.00',
                                      tax_inclusive: tax?.inclusive ?? false,
                                    }
                                  : l
                              )
                            );
                          }}
                        >
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div>
                          <span>{line.product_name}</span>
                          {line.variant_label ? (
                            <div className="type-caption">{line.variant_label}</div>
                          ) : null}
                        </div>
                      )}
                    </td>

                    <td>
                      {isDraft ? (
                        <div>
                          <input
                            type="number"
                            min={minQtyRequired}
                            className={`form-input ${qtyBelowMin ? 'form-input-error' : ''}`.trim()}
                            value={line.quantity}
                            aria-label={`Quantity for line ${index + 1}`}
                            onChange={(e) => {
                              const raw = Number.parseInt(e.target.value, 10);
                              const nextQty = Number.isNaN(raw) ? 0 : raw;
                              setDraftLines((prev) =>
                                prev.map((l, i) => (i === index ? { ...l, quantity: nextQty } : l))
                              );
                            }}
                          />
                          {qtyBelowMin ? (
                            <span className="form-error-text">Min {minQtyRequired}</span>
                          ) : null}
                        </div>
                      ) : (
                        <span>{line.quantity}</span>
                      )}
                    </td>

                    <td className="money-cell">
                      {isDraft ? (
                        <div>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className={`form-input ${negativeUnit ? 'form-input-error' : ''}`.trim()}
                            style={{ textAlign: 'right' }}
                            value={line.unit_price}
                            aria-label={`Unit price for line ${index + 1}`}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDraftLines((prev) =>
                                prev.map((l, i) => (i === index ? { ...l, unit_price: val } : l))
                              );
                            }}
                          />
                          {negativeUnit ? (
                            <span className="form-error-text">Cannot be &lt; 0</span>
                          ) : null}
                        </div>
                      ) : (
                        formatMoney(line.unit_price, sub.currency)
                      )}
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <StatusChip
                        status={`${line.tax_rate}% ${line.tax_inclusive ? 'Inc' : 'Excl'}`}
                        variant={line.tax_inclusive ? 'active' : 'neutral'}
                        showDot={false}
                      />
                    </td>

                    <td className="money-cell">{formatMoney(line.line_subtotal, sub.currency)}</td>
                    <td className="money-cell">{formatMoney(line.line_tax, sub.currency)}</td>
                    <td className="money-cell">{formatMoney(line.line_total, sub.currency)}</td>

                    {isDraft ? (
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger-outline"
                          disabled={draftLines.length <= 1}
                          onClick={() =>
                            setDraftLines((prev) => prev.filter((_, i) => i !== index))
                          }
                          aria-label="Remove line"
                          style={{ padding: 6 }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Document Totals Summary Footer */}
        <div
          style={{
            padding: '18px 24px',
            backgroundColor: 'var(--color-canvas-sand)',
            borderTop: '1px solid var(--color-hairline)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div className="type-caption" style={{ maxWidth: 460 }}>
            {livePricing.discountLabel ? (
              <div style={{ marginBottom: 4 }}>
                Active Discount Applied:{' '}
                <StatusChip status={livePricing.discountLabel} variant="yellow" showDot={false} />
              </div>
            ) : null}
            Note: Discounts are verified for expiry at each invoice generation date. Rounding uses half-up 2-decimal precision.
          </div>

          <div style={{ minWidth: 280, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="type-caption">Untaxed Subtotal</span>
              <span className="money-cell">{formatMoney(livePricing.subtotal, sub.currency)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="type-caption">Discount Deduction</span>
              <span className="money-cell" style={{ color: 'var(--chip-active-text)' }}>
                -{formatMoney(livePricing.discountTotal, sub.currency)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="type-caption">Estimated Tax</span>
              <span className="money-cell">{formatMoney(livePricing.taxTotal, sub.currency)}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                paddingTop: 8,
                borderTop: '1px solid var(--color-hairline-strong)',
                fontSize: 18,
              }}
            >
              <span>Recurring Total</span>
              <span className="money-cell">{formatMoney(livePricing.total, sub.currency)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Activity Timeline */}
      <section className="product-tile">
        <span className="eyebrow-cap">Audit Trail</span>
        <h2 className="type-heading" style={{ marginTop: 4, marginBottom: 14 }}>
          Subscription Activity Timeline
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sub.activities.map((act) => (
            <div
              key={act.id}
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--rounded-md)',
                backgroundColor: 'var(--color-canvas-sand)',
                border: '1px solid var(--color-hairline)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div>{act.action}</div>
                <span className="type-caption">{act.note}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="mono-text">{act.actor_email}</div>
                <span className="type-caption">{formatDateTime(act.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Lifecycle Modals */}
      <ConfirmModal
        isOpen={pauseConfirmOpen}
        title="Pause Active Subscription?"
        description="Warning: Billing skips paused periods. No recurring invoices will be generated until the subscription is resumed."
        confirmLabel="Pause Subscription"
        isLoading={isMutatingState}
        onConfirm={() => void handlePause()}
        onCancel={() => setPauseConfirmOpen(false)}
      />

      <ConfirmModal
        isOpen={activateConfirmOpen}
        title="Activate Subscription?"
        description="Activating locks line item snapshots, sets today as the start date, and schedules automated billing runs."
        confirmLabel="Activate Now"
        isLoading={isMutatingState}
        onConfirm={() => void dispatchTransition('active')}
        onCancel={() => setActivateConfirmOpen(false)}
      />

      <ConfirmModal
        isOpen={cancelConfirmOpen}
        title="Cancel Subscription Before Activation?"
        description="Cancelled quotations and confirmed orders cannot be reactivated later."
        confirmLabel="Cancel Order"
        destructive
        isLoading={isMutatingState}
        onConfirm={() => void dispatchTransition('cancelled')}
        onCancel={() => setCancelConfirmOpen(false)}
      />

      <Modal
        isOpen={closeModalOpen}
        title="Close Subscription"
        eyebrow="Mandatory Closure Reason"
        onClose={() => setCloseModalOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setCloseModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void handleCloseSub()} isLoading={isMutatingState}>
              Close Subscription
            </Button>
          </>
        }
      >
        <p className="type-caption">
          Closing terminates future billing cycles for {sub.number}. Enter a mandatory closure reason below.
        </p>
        <FormTextarea
          label="Close Reason"
          placeholder="Customer consolidated seats onto annual enterprise contract…"
          value={closeReason}
          onChange={(e) => setCloseReason(e.target.value)}
          error={closeReasonError}
        />
      </Modal>

      {/* SPEC.md §18 Bonus: Upgrade/Downgrade Proration Preview Modal */}
      <Modal
        isOpen={prorationOpen}
        title="Plan Upgrade / Proration Preview"
        eyebrow="Mid-Cycle Change Estimator"
        onClose={() => setProrationOpen(false)}
        footer={
          <Button variant="primary" onClick={() => setProrationOpen(false)}>
            Done
          </Button>
        }
      >
        <FormSelect
          label="Target Plan"
          value={targetUpgradePlanId}
          onChange={(e) => setTargetUpgradePlanId(e.target.value)}
          options={plans.map((p) => ({
            value: p.id,
            label: `${p.name} (${formatMoney(p.price, sub.currency)} / ${p.billing_period})`,
          }))}
        />
        <div
          style={{
            padding: 14,
            borderRadius: 'var(--rounded-md)',
            backgroundColor: 'var(--color-canvas-sand)',
            border: '1px solid var(--color-hairline)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span className="type-caption">Estimated 50% Mid-Cycle Proration Adjustment</span>
          <span className="money-cell">{formatMoney(prorationDelta, sub.currency)}</span>
        </div>
      </Modal>
    </div>
  );
};
