import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, BarChart3, BellRing, Play } from 'lucide-react';
import { apiRequest } from '../../api/client';
import {
  AgingBucketsChart,
  PaymentsByMethodChart,
  RevenueTrendChart,
} from '../../components/charts/FinanceCharts';
import { StatusChip } from '../../components/chips/StatusChip';
import { Button } from '../../components/forms/Primitives';
import { DataTable, type DataColumn } from '../../components/tables/DataTable';
import { BillingRunModal } from '../invoices/BillingRunModal';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { useToast } from '../../hooks/useToast';
import type {
  DashboardSummary,
  Invoice,
  OverdueReportResponse,
  PaymentsReportResponse,
  Subscription,
} from '../../types/domain';
import { daysOverdue, formatDate } from '../../utils/dates';
import { formatMoney, normalizeToMonthlyMrr, parseMoney } from '../../utils/money';

/**
 * FE-6.1 & FE-6.2: Executive & Operational Finance Dashboard [SPEC.md §1, §2, §10, §12.2]
 * - Admin: Full KPI mosaic (Normalized MRR, ARR, Active Subs, Revenue Collected, Total Invoiced,
 *   Outstanding, Overdue Count & Amount, New vs Closed) + Revenue Trend, Payment Methods, Aging Charts + Run Billing Now
 * - Internal Staff: Limited operational view (hides MRR/ARR & Run Billing Now per SPEC.md §2)
 * - Right-aligned currency figures with currency code across every financial KPI & table column
 */
export const DashboardPage: React.FC = () => {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [paymentsReport, setPaymentsReport] = useState<PaymentsReportResponse | null>(null);
  const [overdueInvoices, setOverdueInvoices] = useState<Invoice[]>([]);
  const [activeSubs, setActiveSubs] = useState<Subscription[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Date & horizon filters (FE-6.2)
  const [monthsHorizon, setMonthsHorizon] = useState<'6' | '3'>('6');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [billingModalOpen, setBillingModalOpen] = useState(false);
  const [remindingId, setRemindingId] = useState<string | null>(null);

  const loadDashboard = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      try {
        const qs = new URLSearchParams();
        qs.set('months', monthsHorizon);
        if (fromDate) qs.set('from', fromDate);
        if (toDate) qs.set('to', toDate);

        const [sumRes, payRes, overRes, subRes] = await Promise.all([
          apiRequest<DashboardSummary>(`/reports/summary?${qs.toString()}`),
          apiRequest<PaymentsReportResponse>(`/reports/payments?${qs.toString()}`),
          apiRequest<OverdueReportResponse>('/reports/overdue'),
          apiRequest<Subscription[]>('/reports/active-subscriptions'),
        ]);

        setSummary(sumRes);
        setPaymentsReport(payRes);
        setOverdueInvoices(overRes.items);
        setActiveSubs(subRes);
      } catch (err) {
        if (!silent) {
          showToast(err instanceof Error ? err.message : 'Failed to load finance dashboard', 'error');
        }
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [fromDate, monthsHorizon, showToast, toDate]
  );

  useEffect(() => {
    void loadDashboard(false);
  }, [loadDashboard]);

  const syncDashboardSilently = useCallback(() => {
    void loadDashboard(true);
  }, [loadDashboard]);

  // Real-time cross-tab & mutation synchronization + 30s live telemetry revalidation
  useRealtimeSync(syncDashboardSilently, { pollIntervalMs: 30000 });

  const handleQuickRemind = async (inv: Invoice) => {
    setRemindingId(inv.id);
    try {
      await apiRequest(`/invoices/${inv.id}/remind`, { method: 'POST' });
      showToast(`Payment reminder dispatched to ${inv.customer_name} (${inv.number}).`, 'success');
      await loadDashboard();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Reminder failed', 'error');
    } finally {
      setRemindingId(null);
    }
  };

  const currency = summary?.currency ?? 'INR';

  const overdueColumns: DataColumn<Invoice>[] = [
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
      render: (row) => row.customer_name,
    },
    {
      key: 'due_date',
      header: 'Past Due',
      sortValue: (row) => daysOverdue(row.due_date),
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StatusChip status="Overdue" variant="overdue" />
          <span className="type-caption">{daysOverdue(row.due_date)}d overdue</span>
        </div>
      ),
    },
    {
      key: 'balance',
      header: 'Balance Due',
      align: 'right',
      sortValue: (row) => parseMoney(row.balance),
      render: (row) => (
        <span className="cell-numeric" style={{ color: 'var(--chip-overdue-text)' }}>
          {formatMoney(row.balance, row.currency)}
        </span>
      ),
    },
    {
      key: 'remind',
      header: 'Dunning',
      align: 'right',
      render: (row) => (
        <Button
          variant="sand"
          style={{ padding: '5px 10px', fontSize: 12 }}
          isLoading={remindingId === row.id}
          onClick={() => void handleQuickRemind(row)}
        >
          <BellRing size={13} />
          Send Reminder
        </Button>
      ),
    },
  ];

  const activeSubColumns: DataColumn<Subscription>[] = [
    {
      key: 'number',
      header: 'Subscription',
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
      header: 'Plan & Cadence',
      render: (row) => (
        <div>
          <div>{row.plan_name}</div>
          <div className="type-caption" style={{ textTransform: 'capitalize' }}>
            {row.billing_period} · Anchor day {row.anchor_day}
          </div>
        </div>
      ),
    },
    {
      key: 'next_billing_date',
      header: 'Next Billing',
      render: (row) => formatDate(row.next_billing_date),
    },
    ...(isAdmin
      ? ([
          {
            key: 'mrr',
            header: 'Normalized MRR',
            align: 'right' as const,
            sortValue: (row: Subscription) => normalizeToMonthlyMrr(row.total, row.billing_period),
            render: (row: Subscription) => (
              <span className="cell-numeric">
                {formatMoney(normalizeToMonthlyMrr(row.total, row.billing_period), row.currency)}
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">
            {isAdmin ? 'Single Finance View' : 'Operational Finance Workspace'}
          </span>
          <h1 className="type-display-md">
            {isAdmin ? 'Executive Finance Dashboard' : 'Operations & Collections Overview'}
          </h1>
          <p className="type-caption">
            {isAdmin
              ? 'Normalized recurring revenue, cash collections, dunning exposure, and subscription velocity.'
              : 'Operational view of active subscriptions, upcoming renewals, and overdue dunning queues.'}
          </p>
        </div>

        <div className="page-header-actions">
          <Button variant="outline" onClick={() => navigate('/reports')}>
            <BarChart3 size={14} />
            Reports & CSV
          </Button>
          {isAdmin ? (
            <Button variant="primary" onClick={() => setBillingModalOpen(true)}>
              <Play size={14} />
              Run Billing Now
            </Button>
          ) : null}
        </div>
      </header>

      {/* Date Range & Horizon Filter Toolbar (FE-6.2) */}
      <div className="filter-toolbar">
        <div className="filter-toolbar-left">
          <span className="eyebrow-cap">Reporting Window</span>
          <select
            className="form-select"
            style={{ width: 170 }}
            value={monthsHorizon}
            onChange={(e) => setMonthsHorizon(e.target.value as '6' | '3')}
            aria-label="Trend horizon"
          >
            <option value="6">Last 6 Months</option>
            <option value="3">Last 3 Months</option>
          </select>

          <input
            type="date"
            className="form-input"
            style={{ width: 150 }}
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="Filter from date"
          />
          <input
            type="date"
            className="form-input"
            style={{ width: 150 }}
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="Filter to date"
          />
          {fromDate || toDate ? (
            <Button
              variant="sand"
              style={{ padding: '6px 10px', fontSize: 12 }}
              onClick={() => {
                setFromDate('');
                setToDate('');
              }}
            >
              Reset Dates
            </Button>
          ) : null}
        </div>
        <span className="type-caption">
          Paused subscriptions ({summary?.paused_subscriptions ?? 0}) excluded from MRR/ARR
        </span>
      </div>

      {/* Staff RBAC Notice (SPEC.md §2) */}
      {!isAdmin ? (
        <div
          role="status"
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--rounded-lg)',
            backgroundColor: 'var(--color-canvas-cool)',
            border: '1px solid var(--color-hairline)',
          }}
        >
          <span className="type-caption">
            Operational Staff View — Executive financial KPIs (MRR, ARR, Margin) and manual billing
            batch runs are restricted to Admin accounts.
          </span>
        </div>
      ) : null}

      {/* KPI Summary Grid (FE-6.1) */}
      {isLoading && !summary ? (
        <div className="mosaic-grid-4">
          {Array.from({ length: isAdmin ? 8 : 4 }).map((_, idx) => (
            <div key={idx} className="product-tile">
              <div className="skeleton-line" style={{ width: '44%', marginBottom: 14 }} />
              <div className="skeleton-line" style={{ width: '76%', height: 24 }} />
            </div>
          ))}
        </div>
      ) : isAdmin && summary ? (
        <>
          {/* Row 1: Core Recurring & Cash KPIs */}
          <div className="mosaic-grid-4">
            <div className="product-tile surface-SolarWarmth">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="eyebrow-cap">Normalized MRR</span>
                <StatusChip status="Active Only" variant="active" />
              </div>
              <div
                className="type-stat-sm cell-numeric"
                data-testid="kpi-mrr"
                style={{ marginTop: 12 }}
              >
                {formatMoney(summary.mrr, currency)}
              </div>
              <span className="type-caption" style={{ display: 'block', marginTop: 6 }}>
                Monthly ×1 · Yearly ÷12 · Weekly ×52/12
              </span>
            </div>

            <div className="product-tile surface-MorningMist">
              <span className="eyebrow-cap">Annualized Run Rate (ARR)</span>
              <div
                className="type-stat-sm cell-numeric"
                data-testid="kpi-arr"
                style={{ marginTop: 12 }}
              >
                {formatMoney(summary.arr, currency)}
              </div>
              <span className="type-caption" style={{ display: 'block', marginTop: 6 }}>
                12 × Normalized Active MRR
              </span>
            </div>

            <div className="product-tile surface-MintGlow">
              <span className="eyebrow-cap">Revenue Collected</span>
              <div
                className="type-stat-sm cell-numeric"
                data-testid="kpi-collected"
                style={{ marginTop: 12 }}
              >
                {formatMoney(summary.revenue_collected, currency)}
              </div>
              <span className="type-caption" style={{ display: 'block', marginTop: 6 }}>
                Net settled cash in window
              </span>
            </div>

            <div className="product-tile">
              <span className="eyebrow-cap">Total Invoiced</span>
              <div
                className="type-stat-sm cell-numeric"
                data-testid="kpi-invoiced"
                style={{ marginTop: 12 }}
              >
                {formatMoney(summary.total_invoiced, currency)}
              </div>
              <span className="type-caption" style={{ display: 'block', marginTop: 6 }}>
                Issued non-cancelled invoices
              </span>
            </div>
          </div>

          {/* Row 2: Subscriptions Velocity & Receivables Exposure */}
          <div className="mosaic-grid-4">
            <div className="product-tile">
              <span className="eyebrow-cap">Active Subscriptions</span>
              <div className="type-stat-sm" style={{ marginTop: 12, textAlign: 'right' }}>
                {summary.active_subscriptions}
              </div>
              <span className="type-caption" style={{ display: 'block', marginTop: 6 }}>
                +{summary.paused_subscriptions} paused (billing skipped)
              </span>
            </div>

            <div className="product-tile">
              <span className="eyebrow-cap">Outstanding Amount</span>
              <div
                className="type-stat-sm cell-numeric"
                data-testid="kpi-outstanding"
                style={{ marginTop: 12 }}
              >
                {formatMoney(summary.outstanding_amount, currency)}
              </div>
              <span className="type-caption" style={{ display: 'block', marginTop: 6 }}>
                Open receivable balances
              </span>
            </div>

            <div className="product-tile surface-LavenderHaze">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="eyebrow-cap">Overdue Exposure</span>
                <StatusChip
                  status={`${summary.overdue_invoice_count} overdue`}
                  variant={summary.overdue_invoice_count > 0 ? 'overdue' : 'neutral'}
                />
              </div>
              <div
                className="type-stat-sm cell-numeric"
                data-testid="kpi-overdue"
                style={{
                  marginTop: 12,
                  color:
                    summary.overdue_invoice_count > 0
                      ? 'var(--chip-overdue-text)'
                      : 'var(--color-ink)',
                }}
              >
                {formatMoney(summary.overdue_amount, currency)}
              </div>
              <span className="type-caption" style={{ display: 'block', marginTop: 6 }}>
                Confirmed &amp; past due_date
              </span>
            </div>

            <div className="product-tile surface-TwilightSky">
              <span className="eyebrow-cap">New vs Closed Subs</span>
              <div className="type-stat-sm" style={{ marginTop: 12, textAlign: 'right' }}>
                {summary.new_subscriptions_count} / {summary.closed_subscriptions_count}
              </div>
              <span className="type-caption" style={{ display: 'block', marginTop: 6 }}>
                {summary.new_subscriptions_count} active/pipeline vs {summary.closed_subscriptions_count} closed
              </span>
            </div>
          </div>
        </>
      ) : summary ? (
        /* Operational Staff KPI Row */
        <div className="mosaic-grid-4">
          <div className="product-tile surface-MintGlow">
            <span className="eyebrow-cap">Active Subscriptions</span>
            <div className="type-stat-sm" style={{ marginTop: 10 }}>
              {summary.active_subscriptions}
            </div>
            <span className="type-caption">Currently billing recurring contracts</span>
          </div>

          <div className="product-tile">
            <span className="eyebrow-cap">Paused Contracts</span>
            <div className="type-stat-sm" style={{ marginTop: 10 }}>
              {summary.paused_subscriptions}
            </div>
            <span className="type-caption">Skipped by automated billing runs</span>
          </div>

          <div className="product-tile surface-SolarWarmth">
            <span className="eyebrow-cap">Overdue Dunning Queue</span>
            <div
              className="type-stat-sm"
              style={{
                marginTop: 10,
                color:
                  summary.overdue_invoice_count > 0
                    ? 'var(--chip-overdue-text)'
                    : 'var(--color-ink)',
              }}
            >
              {summary.overdue_invoice_count}
            </div>
            <span className="type-caption">Invoices requiring reminder follow-up</span>
          </div>

          <div className="product-tile">
            <span className="eyebrow-cap">New vs Closed</span>
            <div className="type-stat-sm" style={{ marginTop: 10 }}>
              {summary.new_subscriptions_count} / {summary.closed_subscriptions_count}
            </div>
            <span className="type-caption">Pipeline &amp; active vs closed</span>
          </div>
        </div>
      ) : null}

      {/* Interactive Visualizations Mosaic (FE-6.2) */}
      {summary ? (
        <div className={isAdmin ? 'mosaic-grid-2' : 'mosaic-grid-2'}>
          {isAdmin ? (
            <section className="product-tile" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span className="eyebrow-cap">Monthly Trajectory</span>
                  <h2 className="type-subhead">Invoiced vs Cash Collected</h2>
                </div>
                <Link to="/reports" className="type-caption" style={{ textDecoration: 'underline' }}>
                  Full Revenue Table →
                </Link>
              </div>
              <RevenueTrendChart data={summary.revenue_trend} currency={currency} />
            </section>
          ) : null}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section className="product-tile" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span className="eyebrow-cap">Settlement Mix</span>
                  <h2 className="type-subhead">Payments by Method</h2>
                </div>
                <Link to="/payments" className="type-caption" style={{ textDecoration: 'underline' }}>
                  Ledger →
                </Link>
              </div>
              <PaymentsByMethodChart
                items={paymentsReport?.by_method ?? summary.payments_by_method}
                currency={currency}
              />
            </section>

            <section className="product-tile" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span className="eyebrow-cap">Dunning Exposure</span>
                  <h2 className="type-subhead">Overdue Aging Buckets</h2>
                </div>
                <Link to="/overdue" className="type-caption" style={{ textDecoration: 'underline' }}>
                  Open Dunning Queue →
                </Link>
              </div>
              <AgingBucketsChart
                buckets={summary.aging_buckets}
                currency={currency}
                onSelectBucket={() => navigate('/overdue')}
              />
            </section>
          </div>
        </div>
      ) : null}

      {/* Unified Operational Watchlists: Overdue Invoices + Active Subscriptions */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span className="eyebrow-cap">Immediate Collections</span>
            <h2 className="type-heading">Overdue Invoices Requiring Follow-Up</h2>
          </div>
          <Button variant="outline" onClick={() => navigate('/overdue')}>
            All Aging Buckets
            <ArrowRight size={14} />
          </Button>
        </div>

        <DataTable
          columns={overdueColumns}
          rows={overdueInvoices}
          rowKey={(r) => r.id}
          isLoading={isLoading}
          emptyTitle="Zero overdue invoices"
          emptyDescription="Every confirmed customer invoice is currently within its payment terms."
        />
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span className="eyebrow-cap">Recurring Base</span>
            <h2 className="type-heading">Active Subscriptions</h2>
          </div>
          <Button variant="outline" onClick={() => navigate('/reports')}>
            Filter &amp; Export CSV
            <ArrowRight size={14} />
          </Button>
        </div>

        <DataTable
          columns={activeSubColumns}
          rows={activeSubs}
          rowKey={(r) => r.id}
          isLoading={isLoading}
          emptyTitle="No active subscriptions"
          emptyDescription="Activate a confirmed subscription order to begin recurring billing."
        />
      </section>

      {isAdmin ? (
        <BillingRunModal
          isOpen={billingModalOpen}
          onClose={() => setBillingModalOpen(false)}
          onCompleted={() => void loadDashboard()}
        />
      ) : null}
    </div>
  );
};

