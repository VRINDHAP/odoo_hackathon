import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { apiRequest, ApiClientError } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import {
  Button,
  ConfirmModal,
  FormInput,
  FormSelect,
  Modal,
} from '../../components/forms/Primitives';
import { DataTable, type DataColumn } from '../../components/tables/DataTable';
import { useAuth } from '../../hooks/useAuth';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../hooks/useToast';
import type {
  Customer,
  PaginatedResponse,
  PaymentTerms,
  Plan,
  Product,
  Subscription,
} from '../../types/domain';
import { formatDate } from '../../utils/dates';
import { formatMoney, parseMoney } from '../../utils/money';

/**
 * FE-3.3: Subscriptions List Screen [SPEC.md §2, §5.6, §6.1, §12.2]
 * - Virtualized DataTable (> 100 rows) with status chips, customer/plan filters, 300ms debounced search
 * - Staff delete button disabled per SPEC.md §2 Role Permission Matrix
 */
export const SubscriptionsPage: React.FC = () => {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const debouncedSearch = useDebounce(search, 300);

  // Create Draft Subscription Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newCustomerId, setNewCustomerId] = useState('');
  const [newPlanId, setNewPlanId] = useState('');
  const [newProductId, setNewProductId] = useState('');
  const [newQuantity, setNewQuantity] = useState('5');
  const [newTerms, setNewTerms] = useState<PaymentTerms>('Net 15');
  const [couponCode, setCouponCode] = useState('');
  const [createError, setCreateError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Delete Draft Modal (Admin only; disabled for Staff)
  const [deletingSub, setDeletingSub] = useState<Subscription | null>(null);

  const loadReferenceData = useCallback(async () => {
    try {
      const [custRes, planList, prodList] = await Promise.all([
        apiRequest<PaginatedResponse<Customer>>('/customers?page=1&page_size=100'),
        apiRequest<Plan[]>('/plans'),
        apiRequest<Product[]>('/products'),
      ]);
      const activeCusts = custRes.items.filter((c) => c.status === 'active');
      setCustomers(activeCusts);
      setPlans(planList);
      setProducts(prodList);

      const preselectedCust = searchParams.get('newForCustomer');
      if (preselectedCust) {
        setNewCustomerId(preselectedCust);
        if (planList[0]) {
          setNewPlanId(planList[0].id);
          setNewQuantity(String(planList[0].min_quantity));
        }
        if (prodList[0]) setNewProductId(prodList[0].id);
        setIsCreateOpen(true);
        searchParams.delete('newForCustomer');
        setSearchParams(searchParams, { replace: true });
      } else {
        if (activeCusts[0]) setNewCustomerId(activeCusts[0].id);
        if (planList[0]) {
          setNewPlanId(planList[0].id);
          setNewQuantity(String(planList[0].min_quantity));
        }
        if (prodList[0]) setNewProductId(prodList[0].id);
      }
    } catch {
      // Handled by main list fetch
    }
  }, [searchParams, setSearchParams]);

  const loadSubscriptions = useCallback(async () => {
    setIsLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        page_size: '25',
      });
      if (debouncedSearch) qs.set('search', debouncedSearch);
      if (statusFilter) qs.set('status', statusFilter);
      if (customerFilter) qs.set('customer_id', customerFilter);
      if (planFilter) qs.set('plan_id', planFilter);

      const res = await apiRequest<PaginatedResponse<Subscription>>(`/subscriptions?${qs.toString()}`);
      setSubscriptions(res.items);
      setTotalPages(res.total_pages);
      setTotal(res.total);
    } catch {
      showToast('Failed to load subscriptions', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [customerFilter, debouncedSearch, page, planFilter, showToast, statusFilter]);

  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    void loadSubscriptions();
  }, [loadSubscriptions]);

  const selectedPlan = plans.find((p) => p.id === newPlanId);

  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    const minQty = selectedPlan?.min_quantity ?? 1;
    const qty = Number.parseInt(newQuantity, 10);
    if (!newCustomerId || !newPlanId || !newProductId) {
      setCreateError('Select a customer, plan, and initial product.');
      return;
    }
    if (Number.isNaN(qty) || qty < minQty) {
      setCreateError(`Initial quantity must be at least ${minQty} for ${selectedPlan?.name ?? 'this plan'}.`);
      return;
    }

    const prod = products.find((p) => p.id === newProductId)!;
    setCreateError('');
    setIsCreating(true);
    try {
      const created = await apiRequest<Subscription>('/subscriptions', {
        method: 'POST',
        body: {
          customer_id: newCustomerId,
          plan_id: newPlanId,
          payment_terms: newTerms,
          coupon_code: couponCode.trim() || null,
          lines: [
            {
              id: `sline-${Date.now()}`,
              product_id: prod.id,
              product_name: prod.name,
              variant_id: null,
              variant_label: null,
              quantity: qty,
              unit_price: prod.sales_price,
              tax_rate: '18.00',
              tax_inclusive: false,
              line_subtotal: '0.00',
              line_tax: '0.00',
              line_total: '0.00',
            },
          ],
        },
      });
      showToast(`Created draft ${created.number}`, 'success');
      setIsCreateOpen(false);
      navigate(`/subscriptions/${created.id}`);
    } catch (err) {
      setCreateError(err instanceof ApiClientError ? err.message : 'Failed to create subscription');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteSub = async () => {
    if (!deletingSub) return;
    try {
      await apiRequest<void>(`/subscriptions/${deletingSub.id}`, { method: 'DELETE' });
      setSubscriptions((prev) => prev.filter((s) => s.id !== deletingSub.id));
      showToast(`Deleted ${deletingSub.number}`, 'success');
      setDeletingSub(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  };

  const columns: DataColumn<Subscription>[] = [
    {
      key: 'number',
      header: 'Subscription #',
      sortValue: (s) => s.number,
      render: (s) => <span className="mono-text">{s.number}</span>,
    },
    {
      key: 'customer',
      header: 'Customer',
      sortValue: (s) => s.customer_name,
      render: (s) => <span>{s.customer_name}</span>,
    },
    {
      key: 'plan',
      header: 'Plan & Interval',
      sortValue: (s) => s.plan_name,
      render: (s) => (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span>{s.plan_name}</span>
          <span className="type-caption">{s.billing_period} · Anchor day {s.anchor_day}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Lifecycle State',
      sortValue: (s) => s.status,
      render: (s) => <StatusChip status={s.status} />,
    },
    {
      key: 'next_billing',
      header: 'Next Billing Date',
      render: (s) => (
        <span
          className="type-caption"
          title={s.next_billing_date ? `${s.next_billing_date}T00:00:00Z (UTC)` : 'Not scheduled'}
        >
          {formatDate(s.next_billing_date)}
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Recurring Total',
      align: 'right',
      sortValue: (s) => parseMoney(s.total),
      render: (s) => formatMoney(s.total, s.currency),
    },
    {
      key: 'actions',
      header: 'Delete',
      align: 'right',
      render: (s) => (
        <Button
          variant="danger"
          disabled={!isAdmin}
          title={
            !isAdmin
              ? 'Staff accounts cannot delete subscriptions (RBAC policy)'
              : 'Delete subscription'
          }
          onClick={(e) => {
            e.stopPropagation();
            if (isAdmin) setDeletingSub(s);
          }}
          aria-label={`Delete ${s.number}`}
        >
          <Trash2 size={13} />
        </Button>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">Recurring Revenue Contracts</span>
          <h1 className="type-display-md">Subscriptions</h1>
          <p className="type-caption">
            Track subscriptions from Draft quotation through Active recurring billing, pauses, closures, and renewals.
          </p>
        </div>

        <div className="page-header-actions">
          <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
            <Plus size={15} />
            New Subscription
          </Button>
        </div>
      </header>

      <DataTable
        columns={columns}
        rows={subscriptions}
        rowKey={(s) => s.id}
        isLoading={isLoading}
        onRowClick={(s) => navigate(`/subscriptions/${s.id}`)}
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
                placeholder="Search number, customer, or plan…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                style={{ maxWidth: 260 }}
              />
              <select
                className="form-select"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                style={{ maxWidth: 165 }}
                aria-label="Filter by status"
              >
                <option value="">All States</option>
                <option value="draft">Draft</option>
                <option value="quotation">Quotation</option>
                <option value="confirmed">Confirmed</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="closed">Closed</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select
                className="form-select"
                value={customerFilter}
                onChange={(e) => {
                  setCustomerFilter(e.target.value);
                  setPage(1);
                }}
                style={{ maxWidth: 200 }}
                aria-label="Filter by customer"
              >
                <option value="">All Customers</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name}
                  </option>
                ))}
              </select>
              <select
                className="form-select"
                value={planFilter}
                onChange={(e) => {
                  setPlanFilter(e.target.value);
                  setPage(1);
                }}
                style={{ maxWidth: 185 }}
                aria-label="Filter by plan"
              >
                <option value="">All Plans</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <span className="type-caption">{total} contracts</span>
          </div>
        }
        emptyTitle="No subscriptions match your filters"
        emptyDescription="Create a new draft subscription or instantiate one from Quotation Templates."
      />

      {/* New Draft Subscription Modal */}
      <Modal
        isOpen={isCreateOpen}
        title="Create Draft Subscription"
        eyebrow="POST /api/v1/subscriptions"
        onClose={() => setIsCreateOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreateDraft} isLoading={isCreating}>
              Create Draft →
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateDraft} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {createError ? <div className="form-error-text">{createError}</div> : null}

          <FormSelect
            label="Customer Organization"
            value={newCustomerId}
            onChange={(e) => setNewCustomerId(e.target.value)}
            options={customers.map((c) => ({ value: c.id, label: c.company_name }))}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <FormSelect
              label="Subscription Plan"
              value={newPlanId}
              onChange={(e) => {
                const pid = e.target.value;
                setNewPlanId(pid);
                const pl = plans.find((x) => x.id === pid);
                if (pl) setNewQuantity(String(pl.min_quantity));
              }}
              options={plans
                .filter((p) => p.is_active)
                .map((p) => ({
                  value: p.id,
                  label: `${p.name} (${p.billing_period} · min ${p.min_quantity})`,
                }))}
            />
            <FormSelect
              label="Payment Terms"
              value={newTerms}
              onChange={(e) => setNewTerms(e.target.value as PaymentTerms)}
              options={[
                { value: 'Immediate', label: 'Immediate' },
                { value: 'Net 15', label: 'Net 15' },
                { value: 'Net 30', label: 'Net 30' },
              ]}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <FormSelect
              label="Initial Line Product"
              value={newProductId}
              onChange={(e) => setNewProductId(e.target.value)}
              options={products.map((p) => ({ value: p.id, label: p.name }))}
            />
            <FormInput
              label={`Quantity (Min ${selectedPlan?.min_quantity ?? 1})`}
              type="number"
              min={selectedPlan?.min_quantity ?? 1}
              value={newQuantity}
              onChange={(e) => setNewQuantity(e.target.value)}
            />
          </div>

          <FormInput
            label="Coupon / Discount Code (Optional)"
            placeholder="SCALE15"
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
            helperText="Eligible discounts are evaluated and locked on invoice generation."
          />
        </form>
      </Modal>

      <ConfirmModal
        isOpen={Boolean(deletingSub)}
        title="Delete Subscription?"
        description={`Are you sure you want to permanently remove ${deletingSub?.number ?? ''}?`}
        confirmLabel="Delete Subscription"
        destructive
        onConfirm={() => void handleDeleteSub()}
        onCancel={() => setDeletingSub(null)}
      />
    </div>
  );
};

