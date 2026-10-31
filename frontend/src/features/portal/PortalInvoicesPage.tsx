import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CreditCard, Download, ShieldCheck } from 'lucide-react';
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
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { useToast } from '../../hooks/useToast';
import type { Invoice, PaymentMethod, PaymentRecord } from '../../types/domain';
import { formatDate, isInvoiceOverdue } from '../../utils/dates';
import { generateIdempotencyKey } from '../../utils/idempotency';
import { formatMoney, parseMoney, roundHalfUp, toFixedMoney } from '../../utils/money';

interface PortalPayResponse {
  payment: PaymentRecord;
  invoice: Invoice;
}

const PORTAL_GATEWAY_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'card', label: 'Credit / Corporate Card (Visa · Mastercard · RuPay)' },
  { value: 'upi', label: 'UPI Instant Collect (VPA / QR)' },
  { value: 'bank_transfer', label: 'NetBanking / Corporate NEFT' },
];

/**
 * FE-7.2 (Part A): Customer Portal "My Invoices" & Sandbox Gateway Checkout
 * [SPEC.md §2, §3, §5.9, §7.4, §9, §12.3]
 * - Strictly queries GET /me/invoices and GET /me/invoices/{id}/pdf
 * - Built-in Sandbox Simulation toggle avoids external gateway API key lock-in
 * - Updates invoice badge to Paid immediately upon settlement + offers downloadable PDF receipt
 */
export const PortalInvoicesPage: React.FC = () => {
  const { showToast } = useToast();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Gateway Checkout Modal State
  const [checkoutInvoice, setCheckoutInvoice] = useState<Invoice | null>(null);
  const [sandboxSimulation, setSandboxSimulation] = useState(true);
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [payAmount, setPayAmount] = useState('');
  const [vpaOrCardHint, setVpaOrCardHint] = useState('4242 •••• •••• 4242');
  const [idempotencyKey, setIdempotencyKey] = useState(() => generateIdempotencyKey());
  const [amountError, setAmountError] = useState('');
  const [isPaying, setIsPaying] = useState(false);
  const [completedReceipt, setCompletedReceipt] = useState<PortalPayResponse | null>(null);

  const loadMyInvoices = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      try {
        const data = await apiRequest<Invoice[]>('/me/invoices');
        setInvoices(data);
      } catch (err) {
        if (!silent) {
          showToast(err instanceof Error ? err.message : 'Unable to load invoices', 'error');
        }
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    void loadMyInvoices(false);
  }, [loadMyInvoices]);

  const syncMyInvoicesSilently = useCallback(() => {
    void loadMyInvoices(true);
  }, [loadMyInvoices]);

  useRealtimeSync(syncMyInvoicesSilently, { pollIntervalMs: 30000 });

  const totals = useMemo(() => {
    let paid = 0;
    let outstanding = 0;
    let overdue = 0;
    let currency = 'INR';

    invoices.forEach((inv) => {
      currency = inv.currency;
      if (inv.status === 'cancelled') return;
      paid = roundHalfUp(paid + parseMoney(inv.amount_paid));
      outstanding = roundHalfUp(outstanding + parseMoney(inv.balance));
      if (isInvoiceOverdue(inv)) {
        overdue = roundHalfUp(overdue + parseMoney(inv.balance));
      }
    });

    return { paid, outstanding, overdue, currency };
  }, [invoices]);

  const handleDownloadPdf = async (inv: Invoice) => {
    setDownloadingId(inv.id);
    try {
      const blob = await apiRequest<Blob>(`/me/invoices/${inv.id}/pdf`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${inv.number}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast(`Downloaded ${inv.number}.pdf`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'PDF download failed', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const openCheckout = (inv: Invoice) => {
    setCheckoutInvoice(inv);
    setCompletedReceipt(null);
    setPayAmount(inv.balance);
    setMethod('card');
    setSandboxSimulation(true);
    setAmountError('');
    setIdempotencyKey(generateIdempotencyKey());
  };

  const handleExecuteCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutInvoice) return;

    const val = parseMoney(payAmount);
    const bal = parseMoney(checkoutInvoice.balance);

    if (val <= 0) {
      setAmountError('Enter a positive payment amount.');
      return;
    }
    if (val > bal + 0.001) {
      setAmountError(
        `Amount cannot exceed invoice balance (${formatMoney(
          checkoutInvoice.balance,
          checkoutInvoice.currency
        )}).`
      );
      return;
    }

    setAmountError('');
    setIsPaying(true);

    try {
      const res = await apiRequest<PortalPayResponse>(
        `/me/invoices/${checkoutInvoice.id}/pay`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': idempotencyKey,
          },
          body: {
            method,
            amount: toFixedMoney(val),
            sandbox: sandboxSimulation,
          },
        }
      );

      const nextBal = Math.max(0, roundHalfUp(bal - val));
      const updatedInvoice: Invoice = res.invoice ?? {
        ...checkoutInvoice,
        amount_paid: toFixedMoney(roundHalfUp(parseMoney(checkoutInvoice.amount_paid) + val)),
        balance: toFixedMoney(nextBal),
        status: nextBal <= 0.001 ? 'paid' : checkoutInvoice.status,
      };
      const normalizedReceipt: PortalPayResponse = {
        payment: {
          ...res.payment,
          currency: res.payment.currency ?? checkoutInvoice.currency,
          invoice_number: res.payment.invoice_number ?? checkoutInvoice.number,
          customer_id: res.payment.customer_id ?? checkoutInvoice.customer_id,
          customer_name: res.payment.customer_name ?? checkoutInvoice.customer_name,
        },
        invoice: updatedInvoice,
      };

      setInvoices((prev) =>
        prev.map((item) => (item.id === updatedInvoice.id ? updatedInvoice : item))
      );
      setCompletedReceipt(normalizedReceipt);
      showToast(
        `Payment of ${formatMoney(res.payment.amount, res.payment.currency)} succeeded!`,
        'success'
      );
    } catch (err) {
      showToast(
        err instanceof ApiClientError ? err.message : 'Online payment failed',
        'error'
      );
    } finally {
      setIsPaying(false);
    }
  };

  const columns: DataColumn<Invoice>[] = [
    {
      key: 'number',
      header: 'Invoice #',
      sortValue: (row) => row.number,
      render: (row) => <span className="mono-text">{row.number}</span>,
    },
    {
      key: 'subscription_number',
      header: 'Subscription',
      render: (row) => (
        <span className="mono-text">{row.subscription_number ?? 'One-off'}</span>
      ),
    },
    {
      key: 'issue_date',
      header: 'Issued',
      sortValue: (row) => row.issue_date,
      render: (row) => formatDate(row.issue_date),
    },
    {
      key: 'due_date',
      header: 'Due Date',
      sortValue: (row) => row.due_date,
      render: (row) => formatDate(row.due_date),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StatusChip status={row.status} />
          {isInvoiceOverdue(row) ? (
            <StatusChip status="Overdue" variant="overdue" />
          ) : null}
        </div>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      sortValue: (row) => parseMoney(row.total),
      render: (row) => (
        <span className="cell-numeric">{formatMoney(row.total, row.currency)}</span>
      ),
    },
    {
      key: 'balance',
      header: 'Balance Due',
      align: 'right',
      sortValue: (row) => parseMoney(row.balance),
      render: (row) => (
        <span
          className="cell-numeric"
          style={{
            color: isInvoiceOverdue(row) ? 'var(--chip-overdue-text)' : 'var(--color-ink)',
          }}
        >
          {formatMoney(row.balance, row.currency)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button
            variant="outline"
            style={{ padding: '6px 11px', fontSize: 12 }}
            isLoading={downloadingId === row.id}
            onClick={() => void handleDownloadPdf(row)}
          >
            <Download size={13} />
            {row.status === 'paid' ? 'Receipt PDF' : 'Download PDF'}
          </Button>

          {row.status === 'confirmed' && parseMoney(row.balance) > 0 ? (
            <Button
              variant="primary"
              style={{ padding: '6px 12px', fontSize: 12 }}
              onClick={() => openCheckout(row)}
            >
              <CreditCard size={13} />
              Pay Now
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">Billing &amp; Online Checkout</span>
          <h1 className="type-display-md">My Invoices</h1>
          <p className="type-caption">
            Download official tax invoice PDFs and settle open balances instantly online.
          </p>
        </div>
      </header>

      {/* Always-Visible Paid / Outstanding / Overdue Summary */}
      <div className="mosaic-grid-3">
        <div className="product-tile surface-MintGlow">
          <span className="eyebrow-cap">Paid to Date</span>
          <div className="type-stat-sm cell-numeric" style={{ marginTop: 8 }}>
            {formatMoney(totals.paid, totals.currency)}
          </div>
          <span className="type-caption">Settled invoices &amp; receipts</span>
        </div>

        <div className="product-tile surface-MorningMist">
          <span className="eyebrow-cap">Outstanding Balance</span>
          <div className="type-stat-sm cell-numeric" style={{ marginTop: 8 }}>
            {formatMoney(totals.outstanding, totals.currency)}
          </div>
          <span className="type-caption">Open receivable balance</span>
        </div>

        <div className="product-tile surface-SolarWarmth">
          <span className="eyebrow-cap">Overdue Amount</span>
          <div
            className="type-stat-sm cell-numeric"
            style={{
              marginTop: 8,
              color: totals.overdue > 0 ? 'var(--chip-overdue-text)' : 'var(--color-ink)',
            }}
          >
            {formatMoney(totals.overdue, totals.currency)}
          </div>
          <span className="type-caption">Past due_date balances</span>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={invoices}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        emptyTitle="No invoices issued yet"
        emptyDescription="Your subscription tax invoices will appear here once generated."
      />

      {/* Online Payment Gateway Modal with Built-In Sandbox Toggle (FE-7.2) */}
      <Modal
        isOpen={Boolean(checkoutInvoice)}
        eyebrow="Brightloop Checkout"
        title={
          completedReceipt
            ? `Payment Confirmed — ${completedReceipt.invoice.number}`
            : `Pay Invoice ${checkoutInvoice?.number ?? ''}`
        }
        onClose={() => {
          setCheckoutInvoice(null);
          setCompletedReceipt(null);
        }}
        footer={
          completedReceipt ? (
            <>
              <Button
                variant="outline"
                onClick={() => void handleDownloadPdf(completedReceipt.invoice)}
              >
                <Download size={14} />
                Download Receipt PDF
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setCheckoutInvoice(null);
                  setCompletedReceipt(null);
                }}
              >
                Done
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setCheckoutInvoice(null)}
                disabled={isPaying}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                form="portal-gateway-checkout-form"
                isLoading={isPaying}
              >
                Authorize &amp; Pay {formatMoney(payAmount || '0', checkoutInvoice?.currency ?? 'INR')}
              </Button>
            </>
          )
        }
      >
        {completedReceipt ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              className="surface-MintGlow"
              style={{
                padding: 16,
                borderRadius: 'var(--rounded-lg)',
                border: '1px solid var(--chip-paid-border)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <CheckCircle2 size={22} color="var(--chip-paid-text)" />
              <div>
                <div className="type-body-sm">
                  Settlement Reference:{' '}
                  <span className="mono-text">{completedReceipt.payment.reference}</span>
                </div>
                <div className="type-caption">
                  Invoice status is now <strong>{completedReceipt.invoice.status.toUpperCase()}</strong>
                  {' · '}Remaining balance:{' '}
                  {formatMoney(
                    completedReceipt.invoice.balance,
                    completedReceipt.invoice.currency
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : checkoutInvoice ? (
          <form
            id="portal-gateway-checkout-form"
            onSubmit={(e) => void handleExecuteCheckout(e)}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <ToggleSwitch
              label="Built-In Sandbox Simulation Mode"
              description="Simulates instant Razorpay/Stripe gateway capture locally without requiring third-party API keys."
              checked={sandboxSimulation}
              onChange={setSandboxSimulation}
            />

            <FormSelect
              label="Checkout Method"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              options={PORTAL_GATEWAY_METHODS}
            />

            {!sandboxSimulation ? (
              <FormInput
                label={method === 'upi' ? 'UPI Virtual Payment Address (VPA)' : 'Card / Account Instrument'}
                value={vpaOrCardHint}
                onChange={(e) => setVpaOrCardHint(e.target.value)}
              />
            ) : null}

            <FormInput
              label={`Amount to Pay (${checkoutInvoice.currency})`}
              type="number"
              step="0.01"
              value={payAmount}
              onChange={(e) => {
                setPayAmount(e.target.value);
                if (amountError) setAmountError('');
              }}
              error={amountError}
              helperText={`Remaining balance on ${checkoutInvoice.number}: ${formatMoney(
                checkoutInvoice.balance,
                checkoutInvoice.currency
              )}`}
            />

            <div
              style={{
                padding: '10px 12px',
                borderRadius: 'var(--rounded-md)',
                backgroundColor: 'var(--color-canvas)',
                border: '1px solid var(--color-hairline)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span className="type-caption" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ShieldCheck size={14} />
                Idempotent Gateway Session
              </span>
              <span className="mono-text" style={{ fontSize: 11 }}>
                {idempotencyKey.slice(0, 16)}…
              </span>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
};

