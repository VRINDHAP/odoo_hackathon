import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, CreditCard, RefreshCw } from 'lucide-react';
import { apiRequest } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import { Button } from '../../components/forms/Primitives';
import { DataTable, type DataColumn } from '../../components/tables/DataTable';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../hooks/useToast';
import type {
  AgingBucketLabel,
  AgingBucketSummary,
  Invoice,
  OutstandingReportResponse,
  OverdueReportResponse,
} from '../../types/domain';
import {
  daysOverdue,
  formatDate,
  formatDateTime,
  isInvoiceOverdue,
} from '../../utils/dates';
import { formatMoney, parseMoney } from '../../utils/money';
import { RecordPaymentDrawer } from './RecordPaymentDrawer';

const DEFAULT_BUCKETS: AgingBucketSummary[] = [
  { bucket: '0-30 days', count: 0, amount: '0.00' },
  { bucket: '31-60 days', count: 0, amount: '0.00' },
  { bucket: '61-90 days', count: 0, amount: '0.00' },
  { bucket: '90+ days', count: 0, amount: '0.00' },
];

function classifyAgingBucket(dueDate: string): AgingBucketLabel {
  const age = daysOverdue(dueDate);
  if (age <= 30) return '0-30 days';
  if (age <= 60) return '31-60 days';
  if (age <= 90) return '61-90 days';
  return '90+ days';
}

/**
 * FE-5.3: Outstanding & Overdue Aging / Dunning Screen [SPEC.md §7.5, §10, §12.2]
 * - Queries GET /reports/outstanding and GET /reports/overdue
 * - Renders 0-30, 31-60, 61-90, and 90+ days aging buckets breakdown mosaic
 * - Provides one-click "Send Reminder" dunning action (POST /invoices/{id}/remind)
 */
export const OverdueAgingPage: React.FC = () => {
  const { showToast } = useToast();

  const [outstandingReport, setOutstandingReport] = useState<OutstandingReportResponse | null>(null);
  const [overdueReport, setOverdueReport] = useState<OverdueReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<'overdue' | 'outstanding'>('overdue');
  const [selectedBucket, setSelectedBucket] = useState<AgingBucketLabel | null>(null);
  const [search, setSearch] = useState('');
  const [remindingInvoiceId, setRemindingInvoiceId] = useState<string | null>(null);

  // Quick Record Payment Drawer
  const [drawerInvoiceId, setDrawerInvoiceId] = useState<string | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  const loadAgingReports = useCallback(async () => {
    setIsLoading(true);
    try {
      const [outRes, overRes] = await Promise.all([
        apiRequest<OutstandingReportResponse>('/reports/outstanding'),
        apiRequest<OverdueReportResponse>('/reports/overdue'),
      ]);
      setOutstandingReport(outRes);
      setOverdueReport(overRes);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load aging reports', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadAgingReports();
  }, [loadAgingReports]);

  const currency = overdueReport?.currency ?? outstandingReport?.currency ?? 'INR';
  const buckets = overdueReport?.aging_buckets ?? DEFAULT_BUCKETS;
  const totalOverdueNum = parseMoney(overdueReport?.total_overdue ?? '0');

  const handleSendReminder = async (invoice: Invoice) => {
    setRemindingInvoiceId(invoice.id);
    try {
      const updated = await apiRequest<Invoice>(`/invoices/${invoice.id}/remind`, {
        method: 'POST',
      });

      // Update local state immediately so "Last Sent" reflects new timestamp without flicker
      setOverdueReport((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((item) => (item.id === updated.id ? updated : item)),
            }
          : prev
      );
      setOutstandingReport((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((item) => (item.id === updated.id ? updated : item)),
            }
          : prev
      );

      showToast(
        `Dunning reminder dispatched to ${invoice.customer_name} (${invoice.number}).`,
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to dispatch reminder', 'error');
    } finally {
      setRemindingInvoiceId(null);
    }
  };

  const visibleInvoices = useMemo(() => {
    const base =
      activeTab === 'overdue'
        ? overdueReport?.items ?? []
        : outstandingReport?.items ?? [];

    return base.filter((inv) => {
      if (selectedBucket) {
        if (!isInvoiceOverdue(inv)) return false;
        if (classifyAgingBucket(inv.due_date) !== selectedBucket) return false;
      }
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        const hay = `${inv.number} ${inv.customer_name} ${inv.subscription_number ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activeTab, debouncedSearch, outstandingReport, overdueReport, selectedBucket]);

  const columns: DataColumn<Invoice>[] = [
    {
      key: 'number',
      header: 'Invoice #',
      sortValue: (row) => row.number,
      render: (row) => (
        <Link
          to={`/invoices/${row.id}`}
          className="mono-text"
          style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}
        >
          {row.number}
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
          <div className="type-caption">{row.subscription_number ?? 'Manual Invoice'}</div>
        </div>
      ),
    },
    {
      key: 'due_date',
      header: 'Due Date',
      sortValue: (row) => row.due_date,
      render: (row) => formatDate(row.due_date),
    },
    {
      key: 'aging',
      header: 'Aging Window',
      sortValue: (row) => (isInvoiceOverdue(row) ? daysOverdue(row.due_date) : -1),
      render: (row) => {
        const overdue = isInvoiceOverdue(row);
        if (!overdue) {
          return <StatusChip status="Current Receivable" variant="confirmed" />;
        }
        const age = daysOverdue(row.due_date);
        const bucket = classifyAgingBucket(row.due_date);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <StatusChip status="Overdue" variant="overdue" />
            <span className="type-caption" style={{ color: 'var(--chip-overdue-text)' }}>
              {age}d past due ({bucket})
            </span>
          </div>
        );
      },
    },
    {
      key: 'sent_at',
      header: 'Last Reminder / Sent',
      render: (row) => <span className="type-caption">{formatDateTime(row.sent_at)}</span>,
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
      header: 'Collections Action',
      align: 'right',
      render: (row) => (
        <div
          style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="sand"
            style={{ padding: '6px 11px', fontSize: 12 }}
            isLoading={remindingInvoiceId === row.id}
            onClick={() => void handleSendReminder(row)}
          >
            <BellRing size={13} />
            Send Reminder
          </Button>
          <Button
            variant="outline"
            style={{ padding: '6px 11px', fontSize: 12 }}
            onClick={() => setDrawerInvoiceId(row.id)}
          >
            <CreditCard size={13} />
            Settle
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">Collections & Dunning</span>
          <h1 className="type-display-md">Outstanding & Overdue Aging</h1>
          <p className="type-caption">
            Receivables segmented by aging buckets with one-click customer payment reminders.
          </p>
        </div>

        <div className="page-header-actions">
          <Button variant="outline" onClick={() => void loadAgingReports()} isLoading={isLoading}>
            <RefreshCw size={14} />
            Refresh Aging
          </Button>
        </div>
      </header>

      {/* Top Summary Banner: Total Outstanding vs Total Overdue */}
      <div className="mosaic-grid-2">
        <div className="product-tile surface-MorningMist">
          <span className="eyebrow-cap">Total Outstanding Receivables</span>
          <div className="type-stat-sm cell-numeric" style={{ textAlign: 'left', marginTop: 8 }}>
            {formatMoney(outstandingReport?.total_outstanding ?? '0.00', currency)}
          </div>
          <span className="type-caption">
            {outstandingReport?.outstanding_count ?? 0} confirmed open invoices
          </span>
        </div>

        <div className="product-tile surface-SolarWarmth">
          <span className="eyebrow-cap">Total Overdue Exposure</span>
          <div
            className="type-stat-sm cell-numeric"
            style={{
              textAlign: 'left',
              marginTop: 8,
              color:
                (overdueReport?.overdue_count ?? 0) > 0
                  ? 'var(--chip-overdue-text)'
                  : 'var(--color-ink)',
            }}
          >
            {formatMoney(overdueReport?.total_overdue ?? '0.00', currency)}
          </div>
          <span className="type-caption">
            {overdueReport?.overdue_count ?? 0} past-due invoices requiring follow-up
          </span>
        </div>
      </div>

      {/* 4-Column Aging Buckets Breakdown Widget (SPEC.md §7.5, §10) */}
      <section aria-label="Overdue aging buckets" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="eyebrow-cap">Aging Buckets Breakdown (Past Due)</span>
          {selectedBucket ? (
            <button
              type="button"
              className="btn btn-secondary-sand"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => setSelectedBucket(null)}
            >
              Showing: {selectedBucket} × Clear Filter
            </button>
          ) : (
            <span className="type-caption">Click any aging bucket to filter receivables</span>
          )}
        </div>

        <div className="mosaic-grid-4">
          {buckets.map((b) => {
            const amtNum = parseMoney(b.amount);
            const sharePct =
              totalOverdueNum > 0 ? Math.min(100, Math.round((amtNum / totalOverdueNum) * 100)) : 0;
            const isSelected = selectedBucket === b.bucket;

            return (
              <button
                key={b.bucket}
                type="button"
                onClick={() => {
                  setActiveTab('overdue');
                  setSelectedBucket((prev) => (prev === b.bucket ? null : b.bucket));
                }}
                className="product-tile"
                style={{
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderColor: isSelected ? 'var(--color-ink)' : 'var(--color-hairline)',
                  backgroundColor: isSelected ? 'var(--color-canvas-cool)' : 'var(--color-surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="eyebrow-cap">{b.bucket}</span>
                  <StatusChip
                    status={`${b.count} ${b.count === 1 ? 'inv' : 'invs'}`}
                    variant={b.count > 0 ? 'overdue' : 'neutral'}
                  />
                </div>

                <div
                  className="type-subhead cell-numeric"
                  style={{
                    textAlign: 'left',
                    color: b.count > 0 ? 'var(--chip-overdue-text)' : 'var(--color-ink)',
                  }}
                >
                  {formatMoney(b.amount, currency)}
                </div>

                <div
                  style={{
                    width: '100%',
                    height: 6,
                    borderRadius: 9999,
                    backgroundColor: 'var(--color-canvas-sand)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${sharePct}%`,
                      height: '100%',
                      borderRadius: 9999,
                      backgroundColor:
                        b.bucket === '90+ days' || b.bucket === '61-90 days'
                          ? 'var(--chip-overdue-text)'
                          : 'var(--color-accent-blaze)',
                    }}
                  />
                </div>

                <span className="type-caption">{sharePct}% of overdue volume</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Queue Mode Tabs & Search */}
      <div className="filter-toolbar">
        <div className="filter-toolbar-left">
          <div
            style={{
              display: 'inline-flex',
              padding: 3,
              borderRadius: 'var(--rounded-md)',
              backgroundColor: 'var(--color-canvas-sand)',
              border: '1px solid var(--color-hairline)',
              gap: 4,
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('overdue')}
              className="btn"
              style={{
                padding: '6px 12px',
                fontSize: 13,
                backgroundColor: activeTab === 'overdue' ? 'var(--color-surface)' : 'transparent',
                borderColor: activeTab === 'overdue' ? 'var(--color-hairline)' : 'transparent',
              }}
            >
              Overdue Dunning Queue ({overdueReport?.overdue_count ?? 0})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('outstanding');
                setSelectedBucket(null);
              }}
              className="btn"
              style={{
                padding: '6px 12px',
                fontSize: 13,
                backgroundColor:
                  activeTab === 'outstanding' ? 'var(--color-surface)' : 'transparent',
                borderColor: activeTab === 'outstanding' ? 'var(--color-hairline)' : 'transparent',
              }}
            >
              All Outstanding ({outstandingReport?.outstanding_count ?? 0})
            </button>
          </div>

          <input
            className="form-input"
            style={{ width: 280 }}
            placeholder="Search invoice # or customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search aging receivables"
          />
        </div>

        <span className="type-caption">{visibleInvoices.length} invoices shown</span>
      </div>

      <DataTable
        columns={columns}
        rows={visibleInvoices}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        emptyTitle="No overdue or outstanding invoices found"
        emptyDescription="All confirmed customer receivables in this bucket have been settled."
      />

      <RecordPaymentDrawer
        isOpen={Boolean(drawerInvoiceId)}
        initialInvoiceId={drawerInvoiceId}
        onClose={() => setDrawerInvoiceId(null)}
        onRecorded={() => void loadAgingReports()}
      />
    </div>
  );
};

