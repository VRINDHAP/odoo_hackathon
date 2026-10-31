import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, CheckCircle2, PauseCircle, XCircle } from 'lucide-react';
import { apiRequest, ApiClientError } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import {
  Button,
  FormTextarea,
  LifecycleStepper,
  Modal,
} from '../../components/forms/Primitives';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { useToast } from '../../hooks/useToast';
import type { Subscription } from '../../types/domain';
import { formatDate, formatDateTime, todayIsoDate } from '../../utils/dates';
import { formatMoney } from '../../utils/money';

type PortalRequestType = 'upgrade' | 'pause' | 'cancel';

interface PortalRequestResponse {
  message: string;
  subscription: Subscription;
}

/**
 * FE-7.1: Customer Portal "My Subscriptions" [SPEC.md §2, §6.1, §9, §12.3]
 * - Strictly queries GET /me/subscriptions (customer data isolation)
 * - Displays active plan card, status chip, lifecycle stepper, start & next billing dates
 * - Allows confirming open Quotations (/me/subscriptions/{id}/confirm)
 * - Provides tracked self-service Upgrade / Pause / Cancel request modals (/me/subscriptions/{id}/request)
 */
export const PortalSubscriptionsPage: React.FC = () => {
  const { showToast } = useToast();

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // Self-service request modal
  const [requestTarget, setRequestTarget] = useState<Subscription | null>(null);
  const [requestType, setRequestType] = useState<PortalRequestType>('upgrade');
  const [requestNote, setRequestNote] = useState('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);

  const loadMySubscriptions = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiRequest<Subscription[]>('/me/subscriptions');
      setSubscriptions(data);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Unable to load your subscriptions',
        'error'
      );
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadMySubscriptions();
  }, [loadMySubscriptions]);

  useRealtimeSync(loadMySubscriptions, { pollIntervalMs: 30000 });

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
            Review your active plan details, upcoming renewal dates, and submit plan change requests.
          </p>
        </div>
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
            Once your account team issues a quotation or activates a plan, it will appear here.
          </p>
        </div>
      ) : (
        subscriptions.map((sub) => (
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                <div className="type-body-sm cell-numeric" style={{ textAlign: 'left', marginTop: 4 }}>
                  {formatMoney(sub.subtotal, sub.currency)} + {formatMoney(sub.tax_total, sub.currency)}
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

            {/* Customer Self-Service Actions (No Admin Controls Exposed) */}
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

                {sub.status === 'active' || sub.status === 'paused' ? (
                  <>
                    <Button
                      variant="primary"
                      onClick={() => openRequestModal(sub, 'upgrade')}
                    >
                      <ArrowUpRight size={14} />
                      Request Upgrade
                    </Button>
                    {sub.status === 'active' ? (
                      <Button
                        variant="outline"
                        onClick={() => openRequestModal(sub, 'pause')}
                      >
                        <PauseCircle size={14} />
                        Request Pause
                      </Button>
                    ) : null}
                    <Button
                      variant="sand"
                      onClick={() => openRequestModal(sub, 'cancel')}
                    >
                      <XCircle size={14} />
                      Request Cancellation
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </article>
        ))
      )}

      {/* Self-Service Request Modal */}
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

