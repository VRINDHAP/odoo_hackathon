import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { apiRequest, ApiClientError } from '../../api/client';
import {
  Button,
  FormInput,
  FormSelect,
  SlideOverDrawer,
} from '../../components/forms/Primitives';
import { useToast } from '../../hooks/useToast';
import type {
  Invoice,
  PaginatedResponse,
  PaymentMethod,
  PaymentRecord,
} from '../../types/domain';
import { todayIsoDate } from '../../utils/dates';
import { generateIdempotencyKey } from '../../utils/idempotency';
import { formatMoney, parseMoney, roundHalfUp, toFixedMoney } from '../../utils/money';

interface RecordPaymentDrawerProps {
  isOpen: boolean;
  initialInvoiceId?: string | null;
  onClose: () => void;
  onRecorded?: (payment: PaymentRecord, updatedInvoice: Invoice) => void;
}

interface RecordPaymentResponse {
  payment: PaymentRecord;
  invoice: Invoice;
}

const METHOD_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'bank_transfer', label: 'Bank Transfer (NEFT / RTGS / IMPS)' },
  { value: 'upi', label: 'UPI Instant Settlement' },
  { value: 'card', label: 'Corporate / Credit Card' },
  { value: 'cheque', label: 'Cheque / Clearing Instrument' },
  { value: 'cash', label: 'Cash Receipt' },
  { value: 'other', label: 'Other Settlement Method' },
];

/**
 * FE-5.2: Record Payment Slide-Over Drawer [SPEC.md §5.9, §7.4, §8, §12.2, §13]
 * - Supports partial payments (defaults to invoice.balance)
 * - Strictly blocks overpayment (amount > invoice.balance)
 * - Dispatches Idempotency-Key: <UUIDv4> header and disables submit button in-flight
 */
export const RecordPaymentDrawer: React.FC<RecordPaymentDrawerProps> = ({
  isOpen,
  initialInvoiceId,
  onClose,
  onRecorded,
}) => {
  const { showToast } = useToast();

  const [openInvoices, setOpenInvoices] = useState<Invoice[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);

  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayIsoDate());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => generateIdempotencyKey());
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setIsLoadingInvoices(true);
    setFieldErrors({});
    setIdempotencyKey(generateIdempotencyKey());
    setPaymentDate(todayIsoDate());
    setReference('');
    setNote('');

    apiRequest<PaginatedResponse<Invoice>>('/invoices?status=confirmed&page=1&page_size=100')
      .then((res) => {
        if (cancelled) return;
        const payable = res.items.filter((inv) => parseMoney(inv.balance) > 0);
        setOpenInvoices(payable);

        const target =
          (initialInvoiceId ? payable.find((inv) => inv.id === initialInvoiceId) : undefined) ??
          payable[0];

        if (target) {
          setSelectedInvoiceId(target.id);
          setAmount(target.balance);
        } else {
          setSelectedInvoiceId('');
          setAmount('');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          showToast(
            err instanceof Error ? err.message : 'Failed to load payable invoices',
            'error'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingInvoices(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, initialInvoiceId, showToast]);

  const selectedInvoice = useMemo(
    () => openInvoices.find((inv) => inv.id === selectedInvoiceId) ?? null,
    [openInvoices, selectedInvoiceId]
  );

  const remainingBalance = selectedInvoice ? parseMoney(selectedInvoice.balance) : 0;
  const enteredAmount = parseMoney(amount);

  const liveAmountError = useMemo(() => {
    if (!selectedInvoice || amount.trim() === '') return undefined;
    if (Number.isNaN(Number(amount)) || enteredAmount <= 0) {
      return 'Payment amount must be greater than zero.';
    }
    if (enteredAmount > remainingBalance + 0.001) {
      return `Overpayment blocked: amount exceeds remaining invoice balance (${formatMoney(
        selectedInvoice.balance,
        selectedInvoice.currency
      )}).`;
    }
    return undefined;
  }, [amount, enteredAmount, remainingBalance, selectedInvoice]);

  const handleInvoiceChange = (nextId: string) => {
    setSelectedInvoiceId(nextId);
    setFieldErrors({});
    setIdempotencyKey(generateIdempotencyKey());
    const inv = openInvoices.find((item) => item.id === nextId);
    if (inv) {
      setAmount(inv.balance);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice) {
      setFieldErrors({ invoice_id: 'Select a confirmed invoice with an open balance.' });
      return;
    }

    if (amount.trim() === '' || enteredAmount <= 0) {
      setFieldErrors({ amount: 'Payment amount must be greater than zero.' });
      return;
    }

    if (enteredAmount > remainingBalance + 0.001) {
      setFieldErrors({
        amount: `Overpayment blocked: amount exceeds remaining invoice balance (${formatMoney(
          selectedInvoice.balance,
          selectedInvoice.currency
        )}).`,
      });
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const res = await apiRequest<RecordPaymentResponse>(
        `/invoices/${selectedInvoice.id}/payments`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': idempotencyKey,
          },
          body: {
            method,
            amount: toFixedMoney(enteredAmount),
            payment_date: `${paymentDate}T12:00:00Z`,
            reference:
              reference.trim() ||
              `${method.toUpperCase().replace('_', '-')}-${Date.now().toString().slice(-6)}`,
            note: note.trim(),
          },
        }
      );

      const nextBalance = Math.max(0, roundHalfUp(remainingBalance - enteredAmount));
      const updatedInvoice: Invoice = res.invoice ?? {
        ...selectedInvoice,
        amount_paid: toFixedMoney(roundHalfUp(parseMoney(selectedInvoice.amount_paid) + enteredAmount)),
        balance: toFixedMoney(nextBalance),
        status: nextBalance <= 0.001 ? 'paid' : selectedInvoice.status,
      };
      const normalizedPayment: PaymentRecord = {
        ...res.payment,
        currency: res.payment.currency ?? selectedInvoice.currency,
        invoice_number: res.payment.invoice_number ?? selectedInvoice.number,
        customer_id: res.payment.customer_id ?? selectedInvoice.customer_id,
        customer_name: res.payment.customer_name ?? selectedInvoice.customer_name,
      };

      showToast(
        `Recorded ${formatMoney(normalizedPayment.amount, normalizedPayment.currency)} against ${
          updatedInvoice.number
        }.`,
        'success'
      );
      onRecorded?.(normalizedPayment, updatedInvoice);
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError) {
        const mapped = err.toFieldMap();
        if (Object.keys(mapped).length > 0) {
          setFieldErrors(mapped);
        } else {
          showToast(err.message, 'error');
        }
      } else {
        showToast('Failed to record payment', 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SlideOverDrawer
      isOpen={isOpen}
      eyebrow="Append-Only Cash Settlement"
      title="Record Invoice Payment"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="record-payment-form"
            isLoading={isSubmitting}
            disabled={isSubmitting || isLoadingInvoices || openInvoices.length === 0}
          >
            Record Payment
          </Button>
        </>
      }
    >
      {isLoadingInvoices ? (
        <div className="product-tile-compact" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="skeleton-line" style={{ width: '48%' }} />
          <div className="skeleton-line" style={{ width: '82%' }} />
        </div>
      ) : openInvoices.length === 0 ? (
        <div className="product-tile-compact">
          <div className="eyebrow-cap">All Settled</div>
          <p className="type-body-sm" style={{ marginTop: 6 }}>
            There are currently no Confirmed invoices with a positive remaining balance. Confirm a
            Draft invoice first before recording a settlement.
          </p>
        </div>
      ) : (
        <form
          id="record-payment-form"
          onSubmit={(e) => void handleSubmit(e)}
          style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <FormSelect
            label="Target Confirmed Invoice"
            value={selectedInvoiceId}
            onChange={(e) => handleInvoiceChange(e.target.value)}
            error={fieldErrors.invoice_id}
            options={openInvoices.map((inv) => ({
              value: inv.id,
              label: `${inv.number} — ${inv.customer_name} (Bal: ${formatMoney(
                inv.balance,
                inv.currency
              )})`,
            }))}
          />

          {selectedInvoice ? (
            <div
              className="surface-MorningMist"
              style={{
                padding: 16,
                borderRadius: 'var(--rounded-lg)',
                border: '1px solid var(--color-hairline)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="eyebrow-cap">{selectedInvoice.number}</span>
                <span className="type-caption">{selectedInvoice.customer_name}</span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: 12,
                  paddingTop: 6,
                  borderTop: '1px solid var(--color-hairline)',
                }}
              >
                <div>
                  <div className="type-caption">Document Total</div>
                  <div className="type-body-sm cell-numeric" style={{ textAlign: 'left', marginTop: 2 }}>
                    {formatMoney(selectedInvoice.total, selectedInvoice.currency)}
                  </div>
                </div>
                <div>
                  <div className="type-caption">Already Paid</div>
                  <div className="type-body-sm cell-numeric" style={{ textAlign: 'left', marginTop: 2 }}>
                    {formatMoney(selectedInvoice.amount_paid, selectedInvoice.currency)}
                  </div>
                </div>
                <div>
                  <div className="type-caption">Remaining Balance</div>
                  <div
                    className="type-subhead cell-numeric"
                    style={{ textAlign: 'left', marginTop: 2, fontSize: 15 }}
                  >
                    {formatMoney(selectedInvoice.balance, selectedInvoice.currency)}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <FormSelect
            label="Payment Method"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            error={fieldErrors.method}
            options={METHOD_OPTIONS}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <FormInput
              label={`Settlement Amount (${selectedInvoice?.currency ?? 'INR'})`}
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                if (fieldErrors.amount) {
                  setFieldErrors((prev) => ({ ...prev, amount: '' }));
                }
              }}
              error={fieldErrors.amount || liveAmountError}
              helperText={
                !fieldErrors.amount && !liveAmountError && selectedInvoice
                  ? enteredAmount < remainingBalance
                    ? `Partial settlement — ${formatMoney(
                        roundHalfUp(remainingBalance - enteredAmount),
                        selectedInvoice.currency
                      )} will remain open.`
                    : 'Full balance settlement — transitions invoice to Paid.'
                  : undefined
              }
            />

            {selectedInvoice ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary-sand"
                  style={{ padding: '4px 10px', fontSize: 12 }}
                  onClick={() => setAmount(selectedInvoice.balance)}
                >
                  100% Full Balance ({formatMoney(selectedInvoice.balance, selectedInvoice.currency)})
                </button>
                <button
                  type="button"
                  className="btn btn-secondary-sand"
                  style={{ padding: '4px 10px', fontSize: 12 }}
                  onClick={() =>
                    setAmount(toFixedMoney(roundHalfUp(parseMoney(selectedInvoice.balance) / 2)))
                  }
                >
                  50% Tranche
                </button>
              </div>
            ) : null}
          </div>

          <div className="mosaic-grid-2">
            <FormInput
              label="Payment Date"
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
            <FormInput
              label="Bank / Gateway Reference"
              placeholder="e.g. UTR-HDFC-884120"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>

          <FormInput
            label="Internal Memo / Note"
            placeholder="Optional reconciliation remark..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
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
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldCheck size={15} />
              <span className="type-caption">Idempotency-Key Guard Active</span>
            </div>
            <span className="mono-text" style={{ fontSize: 11 }}>
              {idempotencyKey.slice(0, 18)}…
            </span>
          </div>
        </form>
      )}
    </SlideOverDrawer>
  );
};

