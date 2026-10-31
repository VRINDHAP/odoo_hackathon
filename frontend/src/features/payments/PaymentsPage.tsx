import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Plus, RotateCcw } from 'lucide-react';
import { apiRequest, ApiClientError } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import { Button, ConfirmModal, FormInput } from '../../components/forms/Primitives';
import { DataTable, type DataColumn } from '../../components/tables/DataTable';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../hooks/useToast';
import type { PaginatedResponse, PaymentRecord, SystemSettings } from '../../types/domain';
import { formatDateTime } from '../../utils/dates';
import { formatMoney, parseMoney, roundHalfUp } from '../../utils/money';
import { RecordPaymentDrawer } from './RecordPaymentDrawer';

const METHOD_LABELS: Record<string, string> = {
  card: 'Card',
  upi: 'UPI',
  bank_transfer: 'Bank Transfer',
  cash: 'Cash',
  cheque: 'Cheque',
  other: 'Other',
};

/**
 * FE-5.1: Append-Only Payments Register [SPEC.md §5.9, §7.4, §8, §10, §12.2]
 * - Displays payment_date, invoice_number, customer, method, amount, reference, and reversal tags
 * - Negative Reversal entries render in distinct semantic crimson styling
 * - Supports method/date/search filters + native CSV export (?format=csv)
 * - Auto-opens RecordPaymentDrawer when navigated with ?recordForInvoice=<id>
 */
export const PaymentsPage: React.FC = () => {
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [currency, setCurrency] = useState('INR');
  const [isLoading, setIsLoading] = useState(true);
  const [isExportingCsv, setIsExportingCsv] = useState(false);

  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [reversalFilter, setReversalFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Record Payment Slide-Over Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerInvoiceId, setDrawerInvoiceId] = useState<string | null>(null);

  // Append-Only Reversal Modal
  const [reverseTarget, setReverseTarget] = useState<PaymentRecord | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [reversalError, setReversalError] = useState('');
  const [isReversing, setIsReversing] = useState(false);

  const debouncedSearch = useDebounce(search, 300);

  // Open drawer automatically if linked from InvoiceDetailPage (?recordForInvoice=inv-02)
  useEffect(() => {
    const preselected = searchParams.get('recordForInvoice');
    if (preselected) {
      setDrawerInvoiceId(preselected);
      setDrawerOpen(true);
    }
  }, [searchParams]);

  const buildQueryString = useCallback(
    (includePagination: boolean, csv = false) => {
      const qs = new URLSearchParams();
      if (includePagination) {
        qs.set('page', String(page));
        qs.set('page_size', '25');
      }
      if (methodFilter) qs.set('method', methodFilter);
      if (reversalFilter) qs.set('reversal', reversalFilter);
      if (fromDate) qs.set('from', fromDate);
      if (toDate) qs.set('to', toDate);
      if (debouncedSearch) qs.set('search', debouncedSearch);
      if (csv) qs.set('format', 'csv');
      return qs.toString();
    },
    [debouncedSearch, fromDate, methodFilter, page, reversalFilter, toDate]
  );

  const loadPayments = useCallback(async () => {
    setIsLoading(true);
    try {
      const [payRes, settingsRes] = await Promise.all([
        apiRequest<PaginatedResponse<PaymentRecord>>(
          `/payments?${buildQueryString(true, false)}`
        ),
        apiRequest<SystemSettings>('/settings').catch(() => null),
      ]);
      setPayments(payRes.items);
      setTotalPages(payRes.total_pages);
      setTotal(payRes.total);
      if (settingsRes?.currency) setCurrency(settingsRes.currency);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load payments', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [buildQueryString, showToast]);

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  const summary = useMemo(() => {
    let grossCollected = 0;
    let reversedTotal = 0;
    let reversalCount = 0;

    payments.forEach((p) => {
      const amt = parseMoney(p.amount);
      if (p.is_reversal || amt < 0) {
        reversedTotal = roundHalfUp(reversedTotal + Math.abs(amt));
        reversalCount += 1;
      } else {
        grossCollected = roundHalfUp(grossCollected + amt);
      }
    });

    return {
      grossCollected,
      reversedTotal,
      reversalCount,
      netCollected: roundHalfUp(grossCollected - reversedTotal),
    };
  }, [payments]);

  const handleCloseDrawer = () => {
    setDrawerOpen(false);
    setDrawerInvoiceId(null);
    if (searchParams.has('recordForInvoice')) {
      const next = new URLSearchParams(searchParams);
      next.delete('recordForInvoice');
      setSearchParams(next, { replace: true });
    }
  };

  const handleExportCsv = async () => {
    setIsExportingCsv(true);
    try {
      const blob = await apiRequest<Blob>(
        `/payments?${buildQueryString(false, true)}`,
        { responseType: 'blob' }
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `brightloop-payments-register-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Payments register CSV exported.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'CSV export failed', 'error');
    } finally {
      setIsExportingCsv(false);
    }
  };

  const reversedReferenceSet = useMemo(() => {
    const refs = new Set<string>();
    payments.forEach((p) => {
      if (p.is_reversal && p.reference.startsWith('REV-')) {
        refs.add(p.reference.slice(4));
      }
    });
    return refs;
  }, [payments]);

  const handleConfirmReverse = async () => {
    if (!reverseTarget) return;
    if (!reversalReason.trim()) {
      setReversalError('Reversal reason is mandatory for append-only ledger compliance.');
      return;
    }

    setReversalError('');
    setIsReversing(true);
    try {
      await apiRequest<PaymentRecord>(`/payments/${reverseTarget.id}/reverse`, {
        method: 'POST',
        body: { reversal_reason: reversalReason.trim() },
      });
      showToast(
        `Appended negative reversal entry for ${reverseTarget.reference}.`,
        'info'
      );
      setReverseTarget(null);
      setReversalReason('');
      await loadPayments();
    } catch (err) {
      if (err instanceof ApiClientError) {
        showToast(err.message, 'error');
      } else {
        showToast('Failed to record payment reversal', 'error');
      }
    } finally {
      setIsReversing(false);
    }
  };

  const columns: DataColumn<PaymentRecord>[] = [
    {
      key: 'payment_date',
      header: 'Payment Date',
      sortValue: (row) => row.payment_date,
      render: (row) => <span className="type-caption">{formatDateTime(row.payment_date)}</span>,
    },
    {
      key: 'invoice_number',
      header: 'Invoice #',
      sortValue: (row) => row.invoice_number,
      render: (row) => (
        <Link
          to={`/invoices/${row.invoice_id}`}
          className="mono-text"
          onClick={(e) => e.stopPropagation()}
          style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}
        >
          {row.invoice_number}
        </Link>
      ),
    },
    {
      key: 'customer_name',
      header: 'Customer',
      sortValue: (row) => row.customer_name,
      render: (row) => (
        <div>
          <div style={{ color: 'var(--color-ink)' }}>{row.customer_name}</div>
          {row.is_reversal && row.reversal_reason ? (
            <div className="type-caption" style={{ color: 'var(--chip-overdue-text)' }}>
              Reason: {row.reversal_reason}
            </div>
          ) : row.note ? (
            <div className="type-caption">{row.note}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'method',
      header: 'Method',
      sortValue: (row) => row.method,
      render: (row) => (
        <StatusChip status={METHOD_LABELS[row.method] ?? row.method} variant="neutral" />
      ),
    },
    {
      key: 'reference',
      header: 'Reference',
      render: (row) => <span className="mono-text">{row.reference}</span>,
    },
    {
      key: 'tag',
      header: 'Ledger Tag',
      render: (row) =>
        row.is_reversal || parseMoney(row.amount) < 0 ? (
          <StatusChip status="Reversal" variant="overdue" />
        ) : (
          <StatusChip status="Settled" variant="paid" />
        ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      sortValue: (row) => parseMoney(row.amount),
      render: (row) => {
        const isNeg = row.is_reversal || parseMoney(row.amount) < 0;
        return (
          <span
            className="cell-numeric"
            style={{
              color: isNeg ? 'var(--chip-overdue-text)' : 'var(--color-ink)',
            }}
          >
            {formatMoney(row.amount, row.currency)}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Action',
      align: 'right',
      render: (row) => {
        if (row.is_reversal || parseMoney(row.amount) < 0) {
          return <span className="type-caption">Immutable Reversal</span>;
        }
        if (reversedReferenceSet.has(row.reference)) {
          return <span className="type-caption">Reversed</span>;
        }
        return (
          <Button
            variant="sand"
            style={{ padding: '5px 10px', fontSize: 12 }}
            onClick={(e) => {
              e.stopPropagation();
              setReverseTarget(row);
              setReversalReason('');
              setReversalError('');
            }}
          >
            <RotateCcw size={13} />
            Log Reversal
          </Button>
        );
      },
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">Append-Only Cash Ledger</span>
          <h1 className="type-display-md">Payments Register</h1>
          <p className="type-caption">
            Immutable record of invoice settlements and negative reversal entries. Existing rows are
            never edited in place.
          </p>
        </div>

        <div className="page-header-actions">
          <Button
            variant="outline"
            onClick={() => void handleExportCsv()}
            isLoading={isExportingCsv}
          >
            <Download size={14} />
            Export CSV
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setDrawerInvoiceId(null);
              setDrawerOpen(true);
            }}
          >
            <Plus size={15} />
            Record Payment
          </Button>
        </div>
      </header>

      {/* Summary Mosaic */}
      <div className="mosaic-grid-4">
        <div className="product-tile surface-MintGlow">
          <span className="eyebrow-cap">Net Collected</span>
          <div className="type-stat-sm cell-numeric" style={{ textAlign: 'left', marginTop: 8 }}>
            {formatMoney(summary.netCollected, currency)}
          </div>
          <span className="type-caption">Gross settlements minus reversals</span>
        </div>

        <div className="product-tile">
          <span className="eyebrow-cap">Gross Settlements</span>
          <div className="type-stat-sm cell-numeric" style={{ textAlign: 'left', marginTop: 8 }}>
            {formatMoney(summary.grossCollected, currency)}
          </div>
          <span className="type-caption">Positive cash receipts</span>
        </div>

        <div className="product-tile surface-SolarWarmth">
          <span className="eyebrow-cap">Reversed Instruments</span>
          <div
            className="type-stat-sm cell-numeric"
            style={{
              textAlign: 'left',
              marginTop: 8,
              color: summary.reversalCount > 0 ? 'var(--chip-overdue-text)' : 'var(--color-ink)',
            }}
          >
            {summary.reversedTotal > 0
              ? formatMoney(-summary.reversedTotal, currency)
              : formatMoney(0, currency)}
          </div>
          <span className="type-caption">{summary.reversalCount} append-only reversal rows</span>
        </div>

        <div className="product-tile">
          <span className="eyebrow-cap">Ledger Entries</span>
          <div className="type-stat-sm" style={{ marginTop: 8 }}>
            {total}
          </div>
          <span className="type-caption">Protected by UUIDv4 idempotency</span>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="filter-toolbar">
        <div className="filter-toolbar-left">
          <input
            className="form-input"
            style={{ width: 260 }}
            placeholder="Search invoice #, customer, UTR ref..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            aria-label="Search payments register"
          />

          <select
            className="form-select"
            style={{ width: 175 }}
            value={methodFilter}
            onChange={(e) => {
              setMethodFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by payment method"
          >
            <option value="">All Methods</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
            <option value="cheque">Cheque</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>

          <select
            className="form-select"
            style={{ width: 165 }}
            value={reversalFilter}
            onChange={(e) => {
              setReversalFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by entry type"
          >
            <option value="">All Entries</option>
            <option value="false">Settlements Only</option>
            <option value="true">Reversals Only</option>
          </select>

          <input
            type="date"
            className="form-input"
            style={{ width: 148 }}
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
            aria-label="From payment date"
          />
          <input
            type="date"
            className="form-input"
            style={{ width: 148 }}
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
            aria-label="To payment date"
          />
        </div>
        <span className="type-caption">{total} ledger records</span>
      </div>

      <DataTable
        columns={columns}
        rows={payments}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        page={page}
        totalPages={totalPages}
        totalItems={total}
        onPageChange={setPage}
        emptyTitle="No payment entries match your filter"
        emptyDescription="Record a settlement against a Confirmed invoice or clear your active filters."
      />

      <RecordPaymentDrawer
        isOpen={drawerOpen}
        initialInvoiceId={drawerInvoiceId}
        onClose={handleCloseDrawer}
        onRecorded={() => void loadPayments()}
      />

      {/* Append-Only Reversal Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(reverseTarget)}
        title={`Reverse Payment ${reverseTarget?.reference ?? ''}`}
        description="Payments are append-only and cannot be deleted. Confirming appends a separate negative reversal entry and re-opens the corresponding invoice receivable balance."
        confirmLabel="Append Reversal Row"
        destructive
        isLoading={isReversing}
        onConfirm={() => void handleConfirmReverse()}
        onCancel={() => setReverseTarget(null)}
      >
        <div style={{ marginTop: 8 }}>
          <FormInput
            label="Mandatory Reversal Reason"
            placeholder="e.g. Cheque returned unpaid / chargeback dispute"
            value={reversalReason}
            onChange={(e) => {
              setReversalReason(e.target.value);
              if (reversalError) setReversalError('');
            }}
            error={reversalError}
          />
        </div>
      </ConfirmModal>
    </div>
  );
};

