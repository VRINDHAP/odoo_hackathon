import React, { useState } from 'react';
import { CheckCircle2, Play } from 'lucide-react';
import { apiRequest } from '../../api/client';
import { Button, Modal } from '../../components/forms/Primitives';
import { useToast } from '../../hooks/useToast';
import type { BillingRunSummary } from '../../types/domain';
import { formatDate } from '../../utils/dates';

interface BillingRunModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCompleted?: (summary: BillingRunSummary) => void;
}

/**
 * FE-4.4: Manual Billing Run Trigger & Observability Modal (Admin Only)
 * [SPEC.md §5.10, §7.2, §13]
 * - Calls POST /api/v1/billing/run with Idempotency-Key
 * - Displays created_count, skipped_count, failed_count, error_summary
 */
export const BillingRunModal: React.FC<BillingRunModalProps> = ({
  isOpen,
  onClose,
  onCompleted,
}) => {
  const { showToast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const [summary, setSummary] = useState<BillingRunSummary | null>(null);

  const executeRun = async () => {
    setIsRunning(true);
    try {
      const res = await apiRequest<BillingRunSummary>('/billing/run', {
        method: 'POST',
      });
      setSummary(res);
      showToast(
        `Billing run completed: ${res.created_count} created, ${res.skipped_count} skipped.`,
        'success'
      );
      onCompleted?.(res);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Billing run failed', 'error');
    } finally {
      setIsRunning(false);
    }
  };

  const handleClose = () => {
    setSummary(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Manual Billing Engine Run"
      eyebrow="POST /api/v1/billing/run · Idempotent Job"
      onClose={handleClose}
      footer={
        summary ? (
          <Button variant="primary" onClick={handleClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={handleClose} disabled={isRunning}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void executeRun()} isLoading={isRunning}>
              <Play size={14} />
              Run Billing Now
            </Button>
          </>
        )
      }
    >
      {!summary ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="type-caption" style={{ color: 'var(--color-ink-secondary)' }}>
            Triggers the recurring billing engine across all due <strong>Active</strong> subscriptions.
            Subscriptions in <strong>Paused</strong> status are automatically skipped, and eligible discounts are evaluated against today&apos;s date.
          </p>
          {isRunning ? (
            <div
              style={{
                padding: 16,
                borderRadius: 'var(--rounded-md)',
                backgroundColor: 'var(--color-canvas-sand)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <span className="eyebrow-cap">Executing Batch Cycle…</span>
              <div className="skeleton-line" style={{ width: '85%' }} />
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--rounded-md)',
              backgroundColor: 'var(--chip-active-bg)',
              border: '1px solid var(--chip-active-border)',
              color: 'var(--chip-active-text)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <CheckCircle2 size={16} />
            <span>Billing batch finished for {formatDate(summary.run_date)}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <div className="product-tile-compact" style={{ padding: 14 }}>
              <span className="eyebrow-cap">Created</span>
              <div className="type-display-md" style={{ color: 'var(--chip-active-text)' }}>
                {summary.created_count}
              </div>
              <span className="type-caption">Invoices</span>
            </div>

            <div className="product-tile-compact" style={{ padding: 14 }}>
              <span className="eyebrow-cap">Skipped</span>
              <div className="type-display-md">{summary.skipped_count}</div>
              <span className="type-caption">Paused / Not Due</span>
            </div>

            <div className="product-tile-compact" style={{ padding: 14 }}>
              <span className="eyebrow-cap">Failed</span>
              <div
                className="type-display-md"
                style={{ color: summary.failed_count > 0 ? 'var(--color-danger)' : undefined }}
              >
                {summary.failed_count}
              </div>
              <span className="type-caption">Errors</span>
            </div>
          </div>

          <div
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--rounded-md)',
              backgroundColor: 'var(--color-canvas-cool)',
              border: '1px solid var(--color-hairline)',
            }}
          >
            <span className="eyebrow-cap">Error Summary</span>
            <p className="type-caption" style={{ marginTop: 4 }}>
              {summary.error_summary ?? 'Zero errors encountered during invoice generation.'}
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
};
