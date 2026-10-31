import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Download,
  FileWarning,
  Printer,
  Send,
  XCircle,
} from 'lucide-react';
import { apiRequest, ApiClientError } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import {
  Button,
  ConfirmModal,
  LifecycleStepper,
  Modal,
} from '../../components/forms/Primitives';
import { useToast } from '../../hooks/useToast';
import type { Customer, Invoice, PaymentRecord } from '../../types/domain';
import { formatDate, formatDateTime, isInvoiceOverdue } from '../../utils/dates';
import { formatMoney, parseMoney } from '../../utils/money';

interface InvoiceDetailPayload {
  invoice: Invoice;
  payments: PaymentRecord[];
  customer?: Customer | null;
}

/**
 * FE-4.2 (Part B) & FE-4.3: Invoice Document Detail, Stepper & Lifecycle Actions
 * [SPEC.md §5.9, §6.2, §12.2, §13, §16, §18]
 * - Stepper: Draft -> Confirmed -> Paid (+ Cancelled branch)
 * - Hard Constraint: Paid invoices hide Cancel button and suggest Credit Note
 * - Cancelled invoice banner confirms discount redemption release
 * - Native binary PDF download stream (/invoices/{id}/pdf) + Print view
 */
export const InvoiceDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [detail, setDetail] = useState<InvoiceDetailPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [creditNoteModalOpen, setCreditNoteModalOpen] = useState(false);

  const loadInvoice = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const res = await apiRequest<InvoiceDetailPayload>(`/invoices/${id}`);
      setDetail(res);
    } catch {
      showToast('Invoice document not found', 'error');
      navigate('/invoices');
    } finally {
      setIsLoading(false);
    }
  }, [id, navigate, showToast]);

  useEffect(() => {
    void loadInvoice();
  }, [loadInvoice]);

  const runAction = async (action: 'confirm' | 'cancel' | 'send') => {
    if (!detail) return;
    setIsMutating(true);
    try {
      const updated = await apiRequest<Invoice>(`/invoices/${detail.invoice.id}/${action}`, {
        method: 'POST',
      });
      setDetail({ ...detail, invoice: updated });
      setCancelConfirmOpen(false);
      if (action === 'send') {
        showToast(`Invoice dispatched to customer (${formatDateTime(updated.sent_at)})`, 'success');
      } else if (action === 'cancel') {
        showToast('Invoice cancelled and any discount redemption released', 'success');
      } else {
        showToast('Invoice confirmed and posted to receivables', 'success');
      }
    } catch (err) {
      showToast(err instanceof ApiClientError ? err.message : 'Action failed', 'error');
    } finally {
      setIsMutating(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!detail) return;
    setIsDownloadingPdf(true);
    try {
      const pdfBlob = await apiRequest<Blob>(`/invoices/${detail.invoice.id}/pdf`, {
        method: 'GET',
        responseType: 'blob',
      });
      const blobUrl = URL.createObjectURL(pdfBlob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = `${detail.invoice.number}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 2500);
      showToast(`Downloaded ${detail.invoice.number}.pdf`, 'success');
    } catch {
      showToast('Failed to stream invoice PDF', 'error');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  if (isLoading || !detail) {
    return (
      <div className="product-tile">
        <div className="skeleton-line" style={{ width: '35%', marginBottom: 14 }} />
        <div className="skeleton-line" style={{ width: '75%' }} />
      </div>
    );
  }

  const { invoice, payments, customer } = detail;
  const overdue = isInvoiceOverdue(invoice);
  const hasBalance = parseMoney(invoice.balance) > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="no-print">
        <Link to="/invoices" className="type-caption" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={14} />
          Back to Invoices
        </Link>
      </div>

      {/* SPEC.md §16: Cancelled Invoice Discount Redemption Release Notice */}
      {invoice.status === 'cancelled' ? (
        <div
          role="status"
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--rounded-lg)',
            backgroundColor: 'var(--chip-draft-bg)',
            border: '1px solid var(--chip-draft-border)',
            color: 'var(--chip-draft-text)',
          }}
        >
          This invoice is Cancelled.{' '}
          {invoice.discount_released || invoice.discount_name
            ? `Discount redemption (${invoice.discount_name ?? 'applied rule'}) has been released back to the available usage pool.`
            : 'Receivable balance has been zeroed.'}
        </div>
      ) : null}

      {/* Header & Lifecycle Action Bar */}
      <header className="page-header no-print">
        <div className="page-header-titles">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono-text">{invoice.number}</span>
            <StatusChip status={invoice.status} />
            {overdue ? <StatusChip status="Overdue" variant="overdue" /> : null}
          </div>
          <h1 className="type-display-md">{invoice.customer_name}</h1>
          <p className="type-caption">
            Issued {formatDate(invoice.issue_date)} · Due {formatDate(invoice.due_date)}
            {invoice.sent_at ? ` · Last Sent ${formatDateTime(invoice.sent_at)}` : ' · Not sent yet'}
          </p>
        </div>

        <div className="page-header-actions">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer size={14} />
            Print
          </Button>

          <Button
            variant="outline"
            onClick={() => void handleDownloadPdf()}
            isLoading={isDownloadingPdf}
          >
            <Download size={14} />
            Download PDF
          </Button>

          {invoice.status !== 'cancelled' ? (
            <Button variant="outline" onClick={() => void runAction('send')} isLoading={isMutating}>
              <Send size={14} />
              Send Email
            </Button>
          ) : null}

          {invoice.status === 'draft' ? (
            <>
              <Button variant="danger" onClick={() => setCancelConfirmOpen(true)}>
                <XCircle size={14} />
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void runAction('confirm')} isLoading={isMutating}>
                <CheckCircle2 size={14} />
                Confirm Invoice
              </Button>
            </>
          ) : null}

          {invoice.status === 'confirmed' ? (
            <>
              <Button variant="danger" onClick={() => setCancelConfirmOpen(true)}>
                <XCircle size={14} />
                Cancel
              </Button>
              {hasBalance ? (
                <Button
                  variant="primary"
                  onClick={() => navigate(`/payments?recordForInvoice=${invoice.id}`)}
                >
                  <CreditCard size={14} />
                  Record Payment →
                </Button>
              ) : null}
            </>
          ) : null}

          {/* SPEC.md §6.2 Hard Constraint: Paid invoices hide Cancel and suggest Credit Note */}
          {invoice.status === 'paid' ? (
            <Button variant="sand" onClick={() => setCreditNoteModalOpen(true)}>
              <FileWarning size={14} />
              Issue Credit Note
            </Button>
          ) : null}
        </div>
      </header>

      {/* Stepper + Always-Visible Paid / Outstanding / Overdue Summary */}
      <section className="product-tile-compact" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <LifecycleStepper
          steps={['Draft', 'Confirmed', 'Paid']}
          currentStatus={invoice.status}
          branchStatus={invoice.status === 'cancelled' ? 'Cancelled' : null}
        />

        {invoice.status === 'paid' ? (
          <span className="type-caption">
            Settled invoices are immutable and cannot be cancelled — issue a Credit Note for refunds.
          </span>
        ) : null}
      </section>

      {/* Printable Tax Invoice Document Card */}
      <article className="product-tile" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <span className="eyebrow-cap">Tax Invoice Document</span>
            <h2 className="type-heading" style={{ marginTop: 4 }}>
              {invoice.number}
            </h2>
            {invoice.subscription_id ? (
              <Link
                to={`/subscriptions/${invoice.subscription_id}`}
                className="type-caption"
                style={{ textDecoration: 'underline' }}
              >
                Source Subscription: {invoice.subscription_number}
              </Link>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: 24, textAlign: 'right' }}>
            <div>
              <span className="eyebrow-cap">Paid</span>
              <div style={{ color: 'var(--chip-active-text)' }}>
                {formatMoney(invoice.amount_paid, invoice.currency)}
              </div>
            </div>
            <div>
              <span className="eyebrow-cap">{overdue ? 'Overdue Balance' : 'Balance Due'}</span>
              <div style={{ color: overdue ? 'var(--color-danger)' : undefined }}>
                {formatMoney(invoice.balance, invoice.currency)}
              </div>
            </div>
          </div>
        </div>

        {/* Seller & Customer Bill-To Block (PDF p. 3: Customer details pre-filled on invoice) */}
        <div
          className="mosaic-grid-2"
          style={{
            padding: '14px 16px',
            borderRadius: 'var(--rounded-md)',
            backgroundColor: 'var(--color-canvas-sand)',
            border: '1px solid var(--color-hairline)',
          }}
        >
          <div>
            <span className="eyebrow-cap">Issued By</span>
            <div style={{ marginTop: 4 }}>Brightloop Software Pvt Ltd</div>
            <div className="type-caption">
              Indiranagar 100 Ft Rd, Bengaluru, KA 560038 · GSTIN: 29AABCB7781M1Z4
            </div>
            <div className="type-caption">
              Issue Date: {formatDate(invoice.issue_date)} · Due Date: {formatDate(invoice.due_date)}
            </div>
          </div>

          <div>
            <span className="eyebrow-cap">Bill To Customer</span>
            <div style={{ marginTop: 4 }}>
              <Link
                to={`/customers/${invoice.customer_id}`}
                style={{ color: 'inherit', textDecoration: 'underline' }}
              >
                {customer?.company_name ?? invoice.customer_name}
              </Link>
            </div>
            {customer ? (
              <>
                <div className="type-caption">
                  Attn: {customer.name} · {customer.email}
                  {customer.tax_id ? ` · Tax ID: ${customer.tax_id}` : ''}
                </div>
                <div className="type-caption">
                  {customer.billing_address.line1}, {customer.billing_address.city},{' '}
                  {customer.billing_address.state} {customer.billing_address.postal_code},{' '}
                  {customer.billing_address.country}
                </div>
              </>
            ) : (
              <div className="type-caption">Customer ID: {invoice.customer_id}</div>
            )}
          </div>
        </div>

        <div className="table-scroll">
          <table className="ramp-table">
            <thead>
              <tr>
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>Unit Price</th>
                <th style={{ textAlign: 'right' }}>Tax</th>
                <th style={{ textAlign: 'right' }}>Subtotal</th>
                <th style={{ textAlign: 'right' }}>Tax Amt</th>
                <th style={{ textAlign: 'right' }}>Line Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.description}</td>
                  <td className="money-cell">{line.quantity}</td>
                  <td className="money-cell">{formatMoney(line.unit_price, invoice.currency)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="type-caption">
                      {line.tax_rate}% {line.tax_inclusive ? '(Inc)' : '(Excl)'}
                    </span>
                  </td>
                  <td className="money-cell">{formatMoney(line.line_subtotal, invoice.currency)}</td>
                  <td className="money-cell">{formatMoney(line.line_tax, invoice.currency)}</td>
                  <td className="money-cell">{formatMoney(line.line_total, invoice.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ minWidth: 300, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="type-caption">Subtotal</span>
              <span className="money-cell">{formatMoney(invoice.subtotal, invoice.currency)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="type-caption">
                Discount {invoice.discount_name ? `(${invoice.discount_name})` : ''}
              </span>
              <span className="money-cell" style={{ color: 'var(--chip-active-text)' }}>
                -{formatMoney(invoice.discount_total, invoice.currency)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="type-caption">Total Tax</span>
              <span className="money-cell">{formatMoney(invoice.tax_total, invoice.currency)}</span>
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
              <span>Invoice Total</span>
              <span className="money-cell">{formatMoney(invoice.total, invoice.currency)}</span>
            </div>
          </div>
        </div>
      </article>

      {/* Attached Payments Ledger */}
      <section className="product-tile">
        <span className="eyebrow-cap">Append-Only Settlement History</span>
        <h2 className="type-heading" style={{ marginTop: 4, marginBottom: 12 }}>
          Payments &amp; Reversals ({payments.length})
        </h2>
        {payments.length === 0 ? (
          <p className="type-caption">No payments recorded against this invoice yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {payments.map((p) => (
              <div
                key={p.id}
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--rounded-md)',
                  backgroundColor: 'var(--color-canvas-sand)',
                  border: '1px solid var(--color-hairline)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <StatusChip status={p.method} variant="neutral" showDot={false} />
                  {p.is_reversal ? <StatusChip status="Reversal" variant="cancelled" /> : null}
                  <span className="mono-text">{p.reference}</span>
                  <span className="type-caption">· {formatDateTime(p.payment_date)}</span>
                </div>
                <span
                  className="money-cell"
                  style={{ color: p.is_reversal ? 'var(--color-danger)' : undefined }}
                >
                  {formatMoney(p.amount, p.currency)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmModal
        isOpen={cancelConfirmOpen}
        title="Cancel Invoice?"
        description="Cancelling voids this receivable document and releases any redeemed discount back to its usage pool."
        confirmLabel="Cancel Invoice"
        destructive
        isLoading={isMutating}
        onConfirm={() => void runAction('cancel')}
        onCancel={() => setCancelConfirmOpen(false)}
      />

      <Modal
        isOpen={creditNoteModalOpen}
        title="Credit Note & Refund Guidance"
        eyebrow="SPEC §6.2 & §18 · Accounting Integrity"
        onClose={() => setCreditNoteModalOpen(false)}
        footer={
          <Button variant="primary" onClick={() => setCreditNoteModalOpen(false)}>
            Understood
          </Button>
        }
      >
        <p className="type-caption" style={{ color: 'var(--color-ink-secondary)' }}>
          Paid invoice <strong>{invoice.number}</strong> ({formatMoney(invoice.total, invoice.currency)}) cannot be cancelled directly so historical GST and ledger balances remain immutable.
          To refund or reverse a settled invoice, record a negative Reversal entry in the Payments Register or issue a formal Credit Note against the next cycle.
        </p>
      </Modal>
    </div>
  );
};

