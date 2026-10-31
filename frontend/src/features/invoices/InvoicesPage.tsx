import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
import { apiRequest } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import { Button } from '../../components/forms/Primitives';
import { DataTable, type DataColumn } from '../../components/tables/DataTable';
import { useAuth } from '../../hooks/useAuth';
import { useDebounce } from '../../hooks/useDebounce';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { useToast } from '../../hooks/useToast';
import type { Customer, Invoice, PaginatedResponse, SystemSettings } from '../../types/domain';
import { formatDate, isInvoiceOverdue } from '../../utils/dates';
import { formatMoney, parseMoney, roundHalfUp } from '../../utils/money';
import { BillingRunModal } from './BillingRunModal';

/**
 * FE-4.2 (Part A): Invoices List Screen [SPEC.md §1, §5.9, §12.2]
 * - Always-visible Paid, Outstanding, and Overdue summary mosaic (SPEC.md §1, §5.9)
 * - Derived Overdue badge when confirmed && balance > 0 && due_date < today
 * - Admin "Run Billing Now" button opening BillingRunModal (FE-4.4)
 */
export const InvoicesPage: React.FC = () => {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [currency, setCurrency] = useState('INR');
  const [isLoading, setIsLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [billingModalOpen, setBillingModalOpen] = useState(false);

  const debouncedSearch = useDebounce(search, 300);

  const loadInvoices = useCallback(async () => {
    setIsLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        page_size: '25',
      });
      if (debouncedSearch) qs.set('search', debouncedSearch);
      if (statusFilter) qs.set('status', statusFilter);
      if (customerFilter) qs.set('customer_id', customerFilter);
      if (overdueOnly) qs.set('overdue', 'true');

      const [invRes, custRes, settings] = await Promise.all([
        apiRequest<PaginatedResponse<Invoice>>(`/invoices?${qs.toString()}`),
        apiRequest<PaginatedResponse<Customer>>('/customers?page=1&page_size=100'),
        apiRequest<SystemSettings>('/settings'),
      ]);
      setInvoices(invRes.items);
      setTotalPages(invRes.total_pages);
      setTotal(invRes.total);
      setCustomers(custRes.items);
      setCurrency(settings.currency);
    } catch {
      showToast('Failed to load invoices', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [customerFilter, debouncedSearch, overdueOnly, page, showToast, statusFilter]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  useRealtimeSync(loadInvoices, { pollIntervalMs: 30000 });

  // SPEC.md §1 & §5.9: Paid, Outstanding, and Overdue amounts always visible
  const ledgerRollup = useMemo(() => {
    let paidAmt = 0;
    let outstandingAmt = 0;
    let overdueAmt = 0;
    let overdueCount = 0;

    for (const inv of invoices) {
      if (inv.status === 'cancelled') continue;
      paidAmt = roundHalfUp(paidAmt + parseMoney(inv.amount_paid));
      outstandingAmt = roundHalfUp(outstandingAmt + parseMoney(inv.balance));
      if (isInvoiceOverdue(inv)) {
        overdueCount += 1;
        overdueAmt = roundHalfUp(overdueAmt + parseMoney(inv.balance));
      }
    }
    return { paidAmt, outstandingAmt, overdueAmt, overdueCount };
  }, [invoices]);

  const columns: DataColumn<Invoice>[] = [
    {
      key: 'number',
      header: 'Invoice #',
      sortValue: (i) => i.number,
      render: (i) => (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="mono-text">{i.number}</span>
          {i.subscription_number ? (
            <span className="type-caption" style={{ fontSize: 11 }}>
              {i.subscription_number}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      sortValue: (i) => i.customer_name,
      render: (i) => <span>{i.customer_name}</span>,
    },
    {
      key: 'status',
      header: 'Status & Standing',
      sortValue: (i) => i.status,
      render: (i) => (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusChip status={i.status} />
          {isInvoiceOverdue(i) ? <StatusChip status="Overdue" variant="overdue" /> : null}
        </div>
      ),
    },
    {
      key: 'dates',
      header: 'Issued / Due',
      sortValue: (i) => i.due_date,
      render: (i) => (
        <span className="type-caption">
          {formatDate(i.issue_date)} → {formatDate(i.due_date)}
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      sortValue: (i) => parseMoney(i.total),
      render: (i) => formatMoney(i.total, i.currency),
    },
    {
      key: 'paid',
      header: 'Paid',
      align: 'right',
      sortValue: (i) => parseMoney(i.amount_paid),
      render: (i) => (
        <span style={{ color: 'var(--chip-active-text)' }}>
          {formatMoney(i.amount_paid, i.currency)}
        </span>
      ),
    },
    {
      key: 'balance',
      header: 'Balance Due',
      align: 'right',
      sortValue: (i) => parseMoney(i.balance),
      render: (i) => (
        <span style={{ color: isInvoiceOverdue(i) ? 'var(--color-danger)' : undefined }}>
          {formatMoney(i.balance, i.currency)}
        </span>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">Accounts Receivable</span>
          <h1 className="type-display-md">Invoices &amp; Billing Ledger</h1>
          <p className="type-caption">
            Confirm draft invoices, dispatch customer PDFs, and track paid, outstanding, and overdue receivables.
          </p>
        </div>

        {isAdmin ? (
          <div className="page-header-actions">
            <Button variant="primary" onClick={() => setBillingModalOpen(true)}>
              <Play size={14} />
              Run Billing Now
            </Button>
          </div>
        ) : null}
      </header>

      {/* Always-Visible Paid / Outstanding / Overdue Summary Mosaic */}
      <section className="kpi-mosaic-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <div className="product-tile-compact">
          <span className="eyebrow-cap">Paid Amount</span>
          <div className="type-display-md" style={{ color: 'var(--chip-active-text)', marginTop: 4 }}>
            {formatMoney(ledgerRollup.paidAmt, currency)}
          </div>
          <span className="type-caption">Settled on current view</span>
        </div>

        <div className="product-tile-compact">
          <span className="eyebrow-cap">Outstanding Receivable</span>
          <div className="type-display-md" style={{ marginTop: 4 }}>
            {formatMoney(ledgerRollup.outstandingAmt, currency)}
          </div>
          <span className="type-caption">Open unpaid balances</span>
        </div>

        <div className="product-tile-compact">
          <span className="eyebrow-cap">Overdue Amount ({ledgerRollup.overdueCount})</span>
          <div
            className="type-display-md"
            style={{
              color: ledgerRollup.overdueCount > 0 ? 'var(--color-danger)' : undefined,
              marginTop: 4,
            }}
          >
            {formatMoney(ledgerRollup.overdueAmt, currency)}
          </div>
          <span className="type-caption">Confirmed &amp; past due date</span>
        </div>
      </section>

      <DataTable
        columns={columns}
        rows={invoices}
        rowKey={(i) => i.id}
        isLoading={isLoading}
        onRowClick={(i) => navigate(`/invoices/${i.id}`)}
        page={page}
        totalPages={totalPages}
        totalItems={total}
        onPageChange={setPage}
        toolbar={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1 }}>
              <input
                type="search"
                className="form-input"
                placeholder="Search invoice #, customer, or sub #…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                style={{ maxWidth: 270 }}
              />
              <select
                className="form-select"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                style={{ maxWidth: 165 }}
                aria-label="Filter by invoice status"
              >
                <option value="">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="confirmed">Confirmed</option>
                <option value="paid">Paid</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select
                className="form-select"
                value={customerFilter}
                onChange={(e) => {
                  setCustomerFilter(e.target.value);
                  setPage(1);
                }}
                style={{ maxWidth: 210 }}
                aria-label="Filter by customer"
              >
                <option value="">All Customers</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name}
                  </option>
                ))}
              </select>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={overdueOnly}
                  onChange={(e) => {
                    setOverdueOnly(e.target.checked);
                    setPage(1);
                  }}
                />
                <span>Overdue only</span>
              </label>
            </div>
            <span className="type-caption">{total} invoices</span>
          </div>
        }
        emptyTitle="No invoices match your filters"
        emptyDescription="Trigger a billing run or activate a subscription to generate recurring tax invoices."
      />

      <BillingRunModal
        isOpen={billingModalOpen}
        onClose={() => setBillingModalOpen(false)}
        onCompleted={() => void loadInvoices()}
      />
    </div>
  );
};

