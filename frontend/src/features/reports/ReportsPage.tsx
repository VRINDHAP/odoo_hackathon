import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { apiRequest } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import { Button } from '../../components/forms/Primitives';
import { DataTable, type DataColumn } from '../../components/tables/DataTable';
import { useAuth } from '../../hooks/useAuth';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../hooks/useToast';
import type {
  Customer,
  PaginatedResponse,
  Plan,
  RevenueReportRow,
  Subscription,
} from '../../types/domain';
import { formatDate } from '../../utils/dates';
import {
  formatMoney,
  normalizeToMonthlyMrr,
  parseMoney,
  roundHalfUp,
} from '../../utils/money';

/**
 * FE-6.3: Active Subscriptions & Monthly Revenue Report Tables with CSV Export
 * [SPEC.md §2, §8, §10, §12.2]
 * - Filterable & sortable Active Subscriptions table -> GET /reports/active-subscriptions?format=csv
 * - Filterable & sortable Revenue by Month/Plan/Product table -> GET /reports/revenue?format=csv
 */
export const ReportsPage: React.FC = () => {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'subscriptions' | 'revenue'>('subscriptions');

  // Filter reference lists
  const [plans, setPlans] = useState<Plan[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Active Subscriptions Report State
  const [subRows, setSubRows] = useState<Subscription[]>([]);
  const [subSearch, setSubSearch] = useState('');
  const [subPlanId, setSubPlanId] = useState('');
  const [subCustomerId, setSubCustomerId] = useState('');
  const [subStatus, setSubStatus] = useState('active');
  const [subFrom, setSubFrom] = useState('');
  const [subTo, setSubTo] = useState('');
  const [isLoadingSubs, setIsLoadingSubs] = useState(true);
  const [isExportingSubsCsv, setIsExportingSubsCsv] = useState(false);

  // Revenue Report State
  const [revRows, setRevRows] = useState<RevenueReportRow[]>([]);
  const [revSearch, setRevSearch] = useState('');
  const [revPlanName, setRevPlanName] = useState('');
  const [revFrom, setRevFrom] = useState('');
  const [revTo, setRevTo] = useState('');
  const [isLoadingRev, setIsLoadingRev] = useState(true);
  const [isExportingRevCsv, setIsExportingRevCsv] = useState(false);

  const debouncedSubSearch = useDebounce(subSearch, 300);
  const debouncedRevSearch = useDebounce(revSearch, 300);

  useEffect(() => {
    Promise.all([
      apiRequest<Plan[]>('/plans').catch(() => []),
      apiRequest<PaginatedResponse<Customer>>('/customers?page=1&page_size=100')
        .then((r) => r.items)
        .catch(() => []),
    ]).then(([planList, custList]) => {
      setPlans(planList);
      setCustomers(custList);
    });
  }, []);

  const buildSubQuery = useCallback(
    (csv = false) => {
      const qs = new URLSearchParams();
      qs.set('status', subStatus);
      if (subPlanId) qs.set('plan_id', subPlanId);
      if (subCustomerId) qs.set('customer_id', subCustomerId);
      if (subFrom) qs.set('from', subFrom);
      if (subTo) qs.set('to', subTo);
      if (debouncedSubSearch) qs.set('search', debouncedSubSearch);
      if (csv) qs.set('format', 'csv');
      return qs.toString();
    },
    [debouncedSubSearch, subCustomerId, subFrom, subPlanId, subStatus, subTo]
  );

  const buildRevQuery = useCallback(
    (csv = false) => {
      const qs = new URLSearchParams();
      if (revPlanName) qs.set('plan_name', revPlanName);
      if (revFrom) qs.set('from', revFrom);
      if (revTo) qs.set('to', revTo);
      if (debouncedRevSearch) qs.set('search', debouncedRevSearch);
      if (csv) qs.set('format', 'csv');
      return qs.toString();
    },
    [debouncedRevSearch, revFrom, revPlanName, revTo]
  );

  useEffect(() => {
    setIsLoadingSubs(true);
    apiRequest<Subscription[]>(`/reports/active-subscriptions?${buildSubQuery(false)}`)
      .then(setSubRows)
      .catch((err) =>
        showToast(err instanceof Error ? err.message : 'Failed to load subscription report', 'error')
      )
      .finally(() => setIsLoadingSubs(false));
  }, [buildSubQuery, showToast]);

  useEffect(() => {
    if (!isAdmin) {
      setIsLoadingRev(false);
      return;
    }
    setIsLoadingRev(true);
    apiRequest<RevenueReportRow[]>(`/reports/revenue?${buildRevQuery(false)}`)
      .then(setRevRows)
      .catch((err) =>
        showToast(err instanceof Error ? err.message : 'Failed to load revenue report', 'error')
      )
      .finally(() => setIsLoadingRev(false));
  }, [buildRevQuery, isAdmin, showToast]);

  const downloadBlobFile = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleExportSubscriptionsCsv = async () => {
    setIsExportingSubsCsv(true);
    try {
      const blob = await apiRequest<Blob>(
        `/reports/active-subscriptions?${buildSubQuery(true)}`,
        { responseType: 'blob' }
      );
      downloadBlobFile(
        blob,
        `brightloop-active-subscriptions-${new Date().toISOString().slice(0, 10)}.csv`
      );
      showToast('Active subscriptions CSV downloaded.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'CSV export failed', 'error');
    } finally {
      setIsExportingSubsCsv(false);
    }
  };

  const handleExportRevenueCsv = async () => {
    setIsExportingRevCsv(true);
    try {
      const blob = await apiRequest<Blob>(`/reports/revenue?${buildRevQuery(true)}`, {
        responseType: 'blob',
      });
      downloadBlobFile(
        blob,
        `brightloop-monthly-revenue-${new Date().toISOString().slice(0, 10)}.csv`
      );
      showToast('Monthly revenue CSV downloaded.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'CSV export failed', 'error');
    } finally {
      setIsExportingRevCsv(false);
    }
  };

  const revTotals = useMemo(() => {
    let invoiced = 0;
    let collected = 0;
    let currency = 'INR';
    revRows.forEach((r) => {
      currency = r.currency;
      invoiced = roundHalfUp(invoiced + parseMoney(r.invoiced));
      collected = roundHalfUp(collected + parseMoney(r.collected));
    });
    return { invoiced, collected, currency };
  }, [revRows]);

  const subColumns: DataColumn<Subscription>[] = [
    {
      key: 'number',
      header: 'Subscription #',
      sortValue: (row) => row.number,
      render: (row) => (
        <Link
          to={`/subscriptions/${row.id}`}
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
      render: (row) => row.customer_name,
    },
    {
      key: 'plan_name',
      header: 'Plan',
      sortValue: (row) => row.plan_name,
      render: (row) => row.plan_name,
    },
    {
      key: 'billing_period',
      header: 'Cadence',
      sortValue: (row) => row.billing_period,
      render: (row) => (
        <span style={{ textTransform: 'capitalize' }}>{row.billing_period}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (row) => row.status,
      render: (row) => <StatusChip status={row.status} />,
    },
    {
      key: 'start_date',
      header: 'Start Date',
      sortValue: (row) => row.start_date ?? '',
      render: (row) => formatDate(row.start_date),
    },
    {
      key: 'next_billing_date',
      header: 'Next Billing Date',
      sortValue: (row) => row.next_billing_date ?? '',
      render: (row) => formatDate(row.next_billing_date),
    },
    ...(isAdmin
      ? ([
          {
            key: 'mrr',
            header: 'Normalized MRR',
            align: 'right' as const,
            sortValue: (row: Subscription) =>
              row.status === 'active'
                ? normalizeToMonthlyMrr(row.total, row.billing_period)
                : 0,
            render: (row: Subscription) => (
              <span className="cell-numeric">
                {row.status === 'active'
                  ? formatMoney(
                      normalizeToMonthlyMrr(row.total, row.billing_period),
                      row.currency
                    )
                  : 'Excluded'}
              </span>
            ),
          },
        ] satisfies DataColumn<Subscription>[])
      : []),
    {
      key: 'total',
      header: 'Term Total',
      align: 'right',
      sortValue: (row) => parseMoney(row.total),
      render: (row) => (
        <span className="cell-numeric">{formatMoney(row.total, row.currency)}</span>
      ),
    },
  ];

  const revColumns: DataColumn<RevenueReportRow>[] = [
    {
      key: 'period',
      header: 'Billing Month',
      sortValue: (row) => row.period,
      render: (row) => <span className="mono-text">{row.period}</span>,
    },
    {
      key: 'plan_name',
      header: 'Plan',
      sortValue: (row) => row.plan_name,
      render: (row) => row.plan_name,
    },
    {
      key: 'product_name',
      header: 'Primary Product',
      sortValue: (row) => row.product_name,
      render: (row) => row.product_name,
    },
    {
      key: 'invoiced',
      header: 'Total Invoiced',
      align: 'right',
      sortValue: (row) => parseMoney(row.invoiced),
      render: (row) => (
        <span className="cell-numeric">{formatMoney(row.invoiced, row.currency)}</span>
      ),
    },
    {
      key: 'collected',
      header: 'Cash Collected',
      align: 'right',
      sortValue: (row) => parseMoney(row.collected),
      render: (row) => (
        <span className="cell-numeric">{formatMoney(row.collected, row.currency)}</span>
      ),
    },
    {
      key: 'realization',
      header: 'Collection %',
      align: 'right',
      sortValue: (row) => {
        const inv = parseMoney(row.invoiced);
        return inv > 0 ? Math.round((parseMoney(row.collected) / inv) * 100) : 0;
      },
      render: (row) => {
        const inv = parseMoney(row.invoiced);
        const pct = inv > 0 ? Math.round((parseMoney(row.collected) / inv) * 100) : 0;
        return (
          <StatusChip
            status={`${pct}%`}
            variant={pct >= 95 ? 'paid' : pct >= 50 ? 'confirmed' : 'overdue'}
          />
        );
      },
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">Financial &amp; Operational Intelligence</span>
          <h1 className="type-display-md">Reports &amp; CSV Exports</h1>
          <p className="type-caption">
            Filterable, sortable subscription and revenue schedules with direct CSV downloads.
          </p>
        </div>

        <div className="page-header-actions">
          {activeTab === 'subscriptions' ? (
            <Button
              variant="primary"
              onClick={() => void handleExportSubscriptionsCsv()}
              isLoading={isExportingSubsCsv}
            >
              <Download size={14} />
              Export Subscriptions CSV
            </Button>
          ) : isAdmin ? (
            <Button
              variant="primary"
              onClick={() => void handleExportRevenueCsv()}
              isLoading={isExportingRevCsv}
            >
              <Download size={14} />
              Export Revenue CSV
            </Button>
          ) : null}
        </div>
      </header>

      {/* Report Selector Tabs */}
      <div
        style={{
          display: 'inline-flex',
          alignSelf: 'flex-start',
          padding: 4,
          borderRadius: 'var(--rounded-md)',
          backgroundColor: 'var(--color-canvas-sand)',
          border: '1px solid var(--color-hairline)',
          gap: 4,
        }}
      >
        <button
          type="button"
          className="btn"
          onClick={() => setActiveTab('subscriptions')}
          style={{
            padding: '7px 14px',
            fontSize: 13,
            backgroundColor:
              activeTab === 'subscriptions' ? 'var(--color-surface)' : 'transparent',
            borderColor:
              activeTab === 'subscriptions' ? 'var(--color-hairline)' : 'transparent',
          }}
        >
          Active Subscriptions Report ({subRows.length})
        </button>

        {isAdmin ? (
          <button
            type="button"
            className="btn"
            onClick={() => setActiveTab('revenue')}
            style={{
              padding: '7px 14px',
              fontSize: 13,
              backgroundColor:
                activeTab === 'revenue' ? 'var(--color-surface)' : 'transparent',
              borderColor:
                activeTab === 'revenue' ? 'var(--color-hairline)' : 'transparent',
            }}
          >
            Monthly Revenue by Plan &amp; Product ({revRows.length})
          </button>
        ) : null}
      </div>

      {activeTab === 'subscriptions' ? (
        <>
          <div className="filter-toolbar">
            <div className="filter-toolbar-left">
              <input
                className="form-input"
                style={{ width: 230 }}
                placeholder="Search sub #, customer, plan..."
                value={subSearch}
                onChange={(e) => setSubSearch(e.target.value)}
                aria-label="Search subscriptions report"
              />

              <select
                className="form-select"
                style={{ width: 175 }}
                value={subPlanId}
                onChange={(e) => setSubPlanId(e.target.value)}
                aria-label="Filter report by plan"
              >
                <option value="">All Plans</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              <select
                className="form-select"
                style={{ width: 185 }}
                value={subCustomerId}
                onChange={(e) => setSubCustomerId(e.target.value)}
                aria-label="Filter report by customer"
              >
                <option value="">All Customers</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name || c.name}
                  </option>
                ))}
              </select>

              <select
                className="form-select"
                style={{ width: 150 }}
                value={subStatus}
                onChange={(e) => setSubStatus(e.target.value)}
                aria-label="Filter report by status"
              >
                <option value="active">Active Only</option>
                <option value="paused">Paused Only</option>
                <option value="closed">Closed Only</option>
                <option value="all">All Statuses</option>
              </select>

              <input
                type="date"
                className="form-input"
                style={{ width: 145 }}
                value={subFrom}
                onChange={(e) => setSubFrom(e.target.value)}
                aria-label="Start date from"
              />
              <input
                type="date"
                className="form-input"
                style={{ width: 145 }}
                value={subTo}
                onChange={(e) => setSubTo(e.target.value)}
                aria-label="Start date to"
              />
            </div>

            <span className="type-caption">{subRows.length} rows</span>
          </div>

          <DataTable
            columns={subColumns}
            rows={subRows}
            rowKey={(r) => r.id}
            isLoading={isLoadingSubs}
            emptyTitle="No subscriptions match report criteria"
            emptyDescription="Adjust plan, customer, status, or start-date filters."
          />
        </>
      ) : (
        <>
          {/* Revenue Summary Mosaic */}
          <div className="mosaic-grid-3">
            <div className="product-tile surface-SolarWarmth">
              <span className="eyebrow-cap">Filtered Invoiced Volume</span>
              <div className="type-stat-sm cell-numeric" style={{ marginTop: 10 }}>
                {formatMoney(revTotals.invoiced, revTotals.currency)}
              </div>
            </div>

            <div className="product-tile surface-MintGlow">
              <span className="eyebrow-cap">Filtered Cash Collected</span>
              <div className="type-stat-sm cell-numeric" style={{ marginTop: 10 }}>
                {formatMoney(revTotals.collected, revTotals.currency)}
              </div>
            </div>

            <div className="product-tile">
              <span className="eyebrow-cap">Net Realization Rate</span>
              <div className="type-stat-sm" style={{ marginTop: 10, textAlign: 'right' }}>
                {revTotals.invoiced > 0
                  ? `${Math.round((revTotals.collected / revTotals.invoiced) * 100)}%`
                  : '0%'}
              </div>
            </div>
          </div>

          <div className="filter-toolbar">
            <div className="filter-toolbar-left">
              <input
                className="form-input"
                style={{ width: 240 }}
                placeholder="Search month, plan, or product..."
                value={revSearch}
                onChange={(e) => setRevSearch(e.target.value)}
                aria-label="Search revenue report"
              />

              <select
                className="form-select"
                style={{ width: 200 }}
                value={revPlanName}
                onChange={(e) => setRevPlanName(e.target.value)}
                aria-label="Filter revenue by plan"
              >
                <option value="">All Plans</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>

              <input
                type="date"
                className="form-input"
                style={{ width: 150 }}
                value={revFrom}
                onChange={(e) => setRevFrom(e.target.value)}
                aria-label="Revenue from date"
              />
              <input
                type="date"
                className="form-input"
                style={{ width: 150 }}
                value={revTo}
                onChange={(e) => setRevTo(e.target.value)}
                aria-label="Revenue to date"
              />
            </div>

            <span className="type-caption">{revRows.length} monthly plan/product rows</span>
          </div>

          <DataTable
            columns={revColumns}
            rows={revRows}
            rowKey={(r) => `${r.period}-${r.plan_name}-${r.product_name}`}
            isLoading={isLoadingRev}
            emptyTitle="No monthly revenue records match"
            emptyDescription="Clear plan or date filters to view all monthly revenue cohorts."
          />
        </>
      )}
    </div>
  );
};

