import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FileSpreadsheet, Plus, Trash2 } from 'lucide-react';
import { apiRequest, ApiClientError } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import {
  Button,
  ConfirmModal,
  FormInput,
  FormSelect,
  Modal,
  SegmentedTabs,
} from '../../components/forms/Primitives';
import { DataTable, type DataColumn } from '../../components/tables/DataTable';
import { useAuth } from '../../hooks/useAuth';
import { useDebounce } from '../../hooks/useDebounce';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { useToast } from '../../hooks/useToast';
import type {
  Customer,
  PaginatedResponse,
  PaymentTerms,
  Plan,
  Product,
  QuotationTemplate,
  Subscription,
} from '../../types/domain';
import { formatDate, todayIsoDate } from '../../utils/dates';
import { formatMoney, parseMoney, roundHalfUp, toFixedMoney } from '../../utils/money';
import { isValidDateRange } from '../../utils/validation';

/**
 * FE-3.3: Subscriptions List Screen [SPEC.md §2, §5.6, §6.1, §12.2 & PDF p. 3]
 * - Segmented status filter tabs + customer/plan filters + 300ms debounced search
 * - Create Draft from Quotation Template OR directly with Variant pricing + Start/Expiry dates
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
  const [templates, setTemplates] = useState<QuotationTemplate[]>([]);
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
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [newCustomerId, setNewCustomerId] = useState('');
  const [newPlanId, setNewPlanId] = useState('');
  const [newProductId, setNewProductId] = useState('');
  const [newVariantId, setNewVariantId] = useState('');
  const [newQuantity, setNewQuantity] = useState('5');
  const [newTerms, setNewTerms] = useState<PaymentTerms>('Net 15');
  const [newStartDate, setNewStartDate] = useState(todayIsoDate());
  const [newExpiryDate, setNewExpiryDate] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [createError, setCreateError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Delete Draft Modal (Admin only; disabled for Staff)
  const [deletingSub, setDeletingSub] = useState<Subscription | null>(null);

  const loadReferenceData = useCallback(async () => {
    try {
      const [custRes, planList, prodList, tplList] = await Promise.all([
        apiRequest<PaginatedResponse<Customer>>('/customers?page=1&page_size=100'),
        apiRequest<Plan[]>('/plans'),
        apiRequest<Product[]>('/products'),
        apiRequest<QuotationTemplate[]>('/templates').catch(() => [] as QuotationTemplate[]),
      ]);
      const activeCusts = custRes.items.filter((c) => c.status === 'active');
      setCustomers(activeCusts);
      setPlans(planList);
      setProducts(prodList);
      setTemplates(tplList);

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

      const res = await apiRequest<PaginatedResponse<Subscription>>(
        `/subscriptions?${qs.toString()}`
      );
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

  useRealtimeSync(loadSubscriptions, { pollIntervalMs: 30000 });

  const selectedPlan = plans.find((p) => p.id === newPlanId);
  const selectedProduct = products.find((p) => p.id === newProductId);
  const selectedVariant = selectedProduct?.variants.find((v) => v.id === newVariantId);
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates]
  );

  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerId) {
      setCreateError('Select an active customer organization.');
      return;
    }
    if (newStartDate && newExpiryDate && !isValidDateRange(newStartDate, newExpiryDate)) {
      setCreateError('Expiry date must be on or after the start date.');
      return;
    }

    setCreateError('');
    setIsCreating(true);
    try {
      // Branch A: Instantiate directly from a Quotation Template (PDF p. 3)
      if (selectedTemplate) {
        const quoteValidUntil = new Date(
          Date.now() + selectedTemplate.validity_days * 86400000
        )
          .toISOString()
          .slice(0, 10);

        const created = await apiRequest<Subscription>('/subscriptions', {
          method: 'POST',
          body: {
            customer_id: newCustomerId,
            plan_id: selectedTemplate.plan_id,
            payment_terms: newTerms,
            start_date: newStartDate || null,
            expiry_date: newExpiryDate || null,
            quote_valid_until: quoteValidUntil,
            coupon_code: couponCode.trim() || null,
            lines: selectedTemplate.lines.map((tl, idx) => ({
              id: `sline-${Date.now()}-${idx}`,
              product_id: tl.product_id,
              product_name: tl.product_name,
              variant_id: tl.variant_id,
              variant_label: tl.variant_label,
              quantity: tl.quantity,
              unit_price: tl.unit_price,
              tax_rate: '18.00',
              tax_inclusive: false,
              line_subtotal: '0.00',
              line_tax: '0.00',
              line_total: '0.00',
            })),
          },
        });
        showToast(
          `Created ${created.number} from template "${selectedTemplate.name}"`,
          'success'
        );
        setIsCreateOpen(false);
        navigate(`/subscriptions/${created.id}`);
        return;
      }

      // Branch B: Custom Draft Subscription
      const minQty = selectedPlan?.min_quantity ?? 1;
      const qty = Number.parseInt(newQuantity, 10);
      if (!newPlanId || !newProductId) {
        setCreateError('Select a customer, plan, and initial product.');
        setIsCreating(false);
        return;
      }
      if (Number.isNaN(qty) || qty < minQty) {
        setCreateError(
          `Initial quantity must be at least ${minQty} for ${selectedPlan?.name ?? 'this plan'}.`
        );
        setIsCreating(false);
        return;
      }

      const prod = products.find((p) => p.id === newProductId)!;
      const effectiveUnit = toFixedMoney(
        roundHalfUp(
          parseMoney(prod.sales_price) +
            (selectedVariant ? parseMoney(selectedVariant.extra_price) : 0)
        )
      );

      const created = await apiRequest<Subscription>('/subscriptions', {
        method: 'POST',
        body: {
          customer_id: newCustomerId,
          plan_id: newPlanId,
          payment_terms: newTerms,
          start_date: newStartDate || null,
          expiry_date: newExpiryDate || null,
          coupon_code: couponCode.trim() || null,
          lines: [
            {
              id: `sline-${Date.now()}`,
              product_id: prod.id,
              product_name: prod.name,
              variant_id: selectedVariant?.id ?? null,
              variant_label: selectedVariant
                ? `${selectedVariant.attribute}: ${selectedVariant.value}`
                : null,
              quantity: qty,
              unit_price: effectiveUnit,
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
      setCreateError(
        err instanceof ApiClientError ? err.message : 'Failed to create subscription'
      );
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
      render: (s) => (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span>{s.customer_name}</span>
          <span className="type-caption">Terms: {s.payment_terms}</span>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Plan & Interval',
      sortValue: (s) => s.plan_name,
      render: (s) => (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span>{s.plan_name}</span>
          <span className="type-caption">
            {s.billing_period} · Anchor day {s.anchor_day}
          </span>
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
      key: 'dates',
      header: 'Start / Next Billing',
      render: (s) => (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="type-caption">Start: {formatDate(s.start_date)}</span>
          <span
            className="type-caption"
            title={
              s.next_billing_date
                ? `${s.next_billing_date}T00:00:00Z (UTC)`
                : 'Not scheduled'
            }
          >
            Next: {formatDate(s.next_billing_date)}
          </span>
        </div>
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
            Track subscriptions from Draft and Quotation through Confirmed, Active recurring billing, pauses, closures, and renewals.
          </p>
        </div>

        <div className="page-header-actions">
          <Link to="/quotation-templates" className="btn btn-outline">
            <FileSpreadsheet size={14} />
            Quotation Templates
          </Link>
          <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
            <Plus size={15} />
            New Subscription
          </Button>
        </div>
      </header>

      {/* Quick Lifecycle Segmented Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <SegmentedTabs
          ariaLabel="Subscription lifecycle quick filter"
          value={statusFilter}
          onChange={(val) => {
            setStatusFilter(val);
            setPage(1);
          }}
          items={[
            { value: '', label: 'All Contracts' },
            { value: 'active', label: 'Active' },
            { value: 'quotation', label: 'Quotation' },
            { value: 'confirmed', label: 'Confirmed' },
            { value: 'draft', label: 'Draft' },
            { value: 'paused', label: 'Paused' },
            { value: 'closed', label: 'Closed' },
          ]}
        />
        <span className="type-caption">{total} matching contracts</span>
      </div>

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
            <span className="type-caption">Click any row to open contract detail</span>
          </div>
        }
        emptyTitle="No subscriptions match your filters"
        emptyDescription="Create a new draft subscription or instantiate one from Quotation Templates."
      />

      {/* New Draft Subscription Modal */}
      <Modal
        isOpen={isCreateOpen}
        title="Create Draft Subscription"
        eyebrow="Quote-to-Subscription Builder"
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

          {templates.length > 0 ? (
            <FormSelect
              label="Start Mode (Template or Custom Draft)"
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              options={[
                { value: '', label: 'Build Custom Draft Directly' },
                ...templates.map((t) => ({
                  value: t.id,
                  label: `Template: ${t.name} (${t.plan_name} · ${t.validity_days}d validity)`,
                })),
              ]}
            />
          ) : null}

          <FormSelect
            label="Customer Organization"
            value={newCustomerId}
            onChange={(e) => setNewCustomerId(e.target.value)}
            options={customers.map((c) => ({ value: c.id, label: c.company_name }))}
          />

          {selectedTemplate ? (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--rounded-md)',
                backgroundColor: 'var(--color-canvas-sand)',
                border: '1px solid var(--color-hairline)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <span className="eyebrow-cap">Pre-Filled Template Bundle</span>
              <div>
                {selectedTemplate.name} · Plan: <strong>{selectedTemplate.plan_name}</strong> · Valid for{' '}
                {selectedTemplate.validity_days} days
              </div>
              <span className="type-caption">
                Includes {selectedTemplate.lines.length} product lines:{' '}
                {selectedTemplate.lines.map((l) => `${l.product_name} × ${l.quantity}`).join(', ')}
              </span>
            </div>
          ) : (
            <>
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
                  onChange={(e) => {
                    setNewProductId(e.target.value);
                    setNewVariantId('');
                  }}
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

              {selectedProduct && selectedProduct.variants.length > 0 ? (
                <FormSelect
                  label="Product Variant (Optional)"
                  value={newVariantId}
                  onChange={(e) => setNewVariantId(e.target.value)}
                  options={[
                    { value: '', label: 'Base Edition (+0.00)' },
                    ...selectedProduct.variants.map((v) => ({
                      value: v.id,
                      label: `${v.attribute}: ${v.value} (+${v.extra_price})`,
                    })),
                  ]}
                />
              ) : null}
            </>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FormInput
              label="Start Date"
              type="date"
              value={newStartDate}
              onChange={(e) => setNewStartDate(e.target.value)}
            />
            <FormInput
              label="Expiry Date (Optional)"
              type="date"
              value={newExpiryDate}
              onChange={(e) => setNewExpiryDate(e.target.value)}
            />
          </div>

          <FormInput
            label="Coupon / Discount Code (Optional)"
            placeholder="SCALE15"
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
            helperText="Eligible discounts are evaluated automatically on invoice generation."
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
