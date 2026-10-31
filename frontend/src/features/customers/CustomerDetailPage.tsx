import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Pencil } from 'lucide-react';
import { apiRequest } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import { Button, ConfirmModal, FormInput } from '../../components/forms/Primitives';
import { DataTable, type DataColumn } from '../../components/tables/DataTable';
import { useToast } from '../../hooks/useToast';
import type {
  BillingAddress,
  Customer,
  Invoice,
  PaymentRecord,
  Subscription,
} from '../../types/domain';
import { formatDate, formatDateTime, isInvoiceOverdue } from '../../utils/dates';
import { formatMoney } from '../../utils/money';

interface CustomerDetailPayload {
  customer: Customer;
  subscriptions: Subscription[];
  invoices: Invoice[];
  payments: PaymentRecord[];
}

/**
 * FE-3.1 (Part B): Customer Detail Screen [SPEC.md §5.2, §12.2, §16]
 * - Profile card + inline billing address editor
 * - 3 relational tabs: Subscriptions, Invoices, Payments
 * - Soft-delete / reactivate toggle preserving historic invoices & subscriptions
 */
export const CustomerDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [detail, setDetail] = useState<CustomerDetailPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'subscriptions' | 'invoices' | 'payments'>('subscriptions');

  // Inline Address Edit
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState<BillingAddress>({
    line1: '',
    line2: '',
    city: '',
    state: '',
    postal_code: '',
    country: 'India',
  });
  const [phoneDraft, setPhoneDraft] = useState('');
  const [taxIdDraft, setTaxIdDraft] = useState('');
  const [isSavingAddress, setIsSavingAddress] = useState(false);

  // Soft-delete modal
  const [confirmArchive, setConfirmArchive] = useState(false);

  const loadCustomer = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const res = await apiRequest<CustomerDetailPayload>(`/customers/${id}`);
      setDetail(res);
      setAddressDraft(res.customer.billing_address);
      setPhoneDraft(res.customer.phone);
      setTaxIdDraft(res.customer.tax_id);
    } catch {
      showToast('Customer record not found', 'error');
      navigate('/customers');
    } finally {
      setIsLoading(false);
    }
  }, [id, navigate, showToast]);

  useEffect(() => {
    void loadCustomer();
  }, [loadCustomer]);

  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setIsSavingAddress(true);
    try {
      const updated = await apiRequest<Customer>(`/customers/${detail.customer.id}`, {
        method: 'PATCH',
        body: {
          phone: phoneDraft.trim(),
          tax_id: taxIdDraft.trim(),
          billing_address: addressDraft,
        },
      });
      setDetail({ ...detail, customer: updated });
      setEditingAddress(false);
      showToast('Billing address & tax profile updated', 'success');
    } catch {
      showToast('Failed to update customer profile', 'error');
    } finally {
      setIsSavingAddress(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!detail) return;
    const nextStatus = detail.customer.status === 'active' ? 'inactive' : 'active';
    try {
      const updated = await apiRequest<Customer>(`/customers/${detail.customer.id}`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
      setDetail({ ...detail, customer: updated });
      setConfirmArchive(false);
      showToast(
        nextStatus === 'inactive'
          ? 'Customer marked inactive. Historic subscriptions and invoices remain browsable.'
          : 'Customer reactivated.',
        'success'
      );
    } catch {
      showToast('Failed to update customer status', 'error');
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

  const { customer, subscriptions, invoices, payments } = detail;

  const subColumns: DataColumn<Subscription>[] = [
    {
      key: 'number',
      header: 'Subscription #',
      render: (s) => <span className="mono-text">{s.number}</span>,
    },
    {
      key: 'plan',
      header: 'Plan',
      render: (s) => (
        <span>
          {s.plan_name} <span className="type-caption">({s.billing_period})</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (s) => <StatusChip status={s.status} />,
    },
    {
      key: 'next_billing',
      header: 'Next Billing',
      render: (s) => <span className="type-caption">{formatDate(s.next_billing_date)}</span>,
    },
    {
      key: 'total',
      header: 'Recurring Total',
      align: 'right',
      render: (s) => formatMoney(s.total, s.currency),
    },
  ];

  const invColumns: DataColumn<Invoice>[] = [
    {
      key: 'number',
      header: 'Invoice #',
      render: (i) => <span className="mono-text">{i.number}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (i) => (
        <div style={{ display: 'inline-flex', gap: 6 }}>
          <StatusChip status={i.status} />
          {isInvoiceOverdue(i) ? <StatusChip status="Overdue" variant="overdue" /> : null}
        </div>
      ),
    },
    {
      key: 'due_date',
      header: 'Due Date',
      render: (i) => <span className="type-caption">{formatDate(i.due_date)}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (i) => formatMoney(i.total, i.currency),
    },
    {
      key: 'balance',
      header: 'Balance Due',
      align: 'right',
      render: (i) => formatMoney(i.balance, i.currency),
    },
  ];

  const payColumns: DataColumn<PaymentRecord>[] = [
    {
      key: 'date',
      header: 'Date',
      render: (p) => <span className="type-caption">{formatDateTime(p.payment_date)}</span>,
    },
    {
      key: 'invoice',
      header: 'Invoice #',
      render: (p) => <span className="mono-text">{p.invoice_number}</span>,
    },
    {
      key: 'method',
      header: 'Method',
      render: (p) => (
        <div style={{ display: 'inline-flex', gap: 6 }}>
          <StatusChip status={p.method} variant="neutral" showDot={false} />
          {p.is_reversal ? <StatusChip status="Reversal" variant="cancelled" /> : null}
        </div>
      ),
    },
    {
      key: 'ref',
      header: 'Reference',
      render: (p) => <span className="mono-text">{p.reference}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (p) => (
        <span style={{ color: p.is_reversal ? 'var(--color-danger)' : undefined }}>
          {formatMoney(p.amount, p.currency)}
        </span>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <Link to="/customers" className="type-caption" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={14} />
          Back to Customer Directory
        </Link>
      </div>

      <header className="page-header">
        <div className="page-header-titles">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="eyebrow-cap">Customer Account</span>
            <StatusChip
              status={customer.status === 'inactive' ? 'Inactive (Soft-Deleted)' : 'Active'}
              variant={customer.status === 'active' ? 'active' : 'draft'}
            />
            {customer.portal_user_linked ? (
              <StatusChip status="Portal Linked" variant="confirmed" showDot={false} />
            ) : null}
          </div>
          <h1 className="type-display-md">{customer.company_name}</h1>
          <p className="type-caption">
            Primary Contact: {customer.name} · {customer.email}
          </p>
        </div>

        <div className="page-header-actions">
          <Button
            variant={customer.status === 'active' ? 'danger' : 'outline'}
            onClick={() => setConfirmArchive(true)}
          >
            {customer.status === 'active' ? 'Mark Inactive' : 'Reactivate Customer'}
          </Button>
          <Button
            variant="primary"
            onClick={() => navigate(`/subscriptions?newForCustomer=${customer.id}`)}
          >
            New Subscription →
          </Button>
        </div>
      </header>

      {/* Profile & Inline Billing Address Card */}
      <section className="product-tile">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <span className="eyebrow-cap">Billing &amp; Tax Profile</span>
            <h2 className="type-heading">Registered Address &amp; GST Details</h2>
          </div>
          {!editingAddress ? (
            <Button variant="outline" onClick={() => setEditingAddress(true)}>
              <Pencil size={13} />
              Edit Billing Address
            </Button>
          ) : null}
        </div>

        {!editingAddress ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
            <div>
              <span className="eyebrow-cap">Billing Address</span>
              <div style={{ marginTop: 4 }}>
                {customer.billing_address.line1 || 'No street address on file'}
                {customer.billing_address.city
                  ? `, ${customer.billing_address.city}, ${customer.billing_address.state} ${customer.billing_address.postal_code}`
                  : ''}
              </div>
              <div className="type-caption">{customer.billing_address.country}</div>
            </div>
            <div>
              <span className="eyebrow-cap">Tax Identifier</span>
              <div className="mono-text" style={{ marginTop: 4 }}>
                {customer.tax_id || 'Unregistered'}
              </div>
            </div>
            <div>
              <span className="eyebrow-cap">Phone</span>
              <div style={{ marginTop: 4 }}>{customer.phone || '—'}</div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSaveAddress} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
              <FormInput
                label="Street Line 1"
                value={addressDraft.line1}
                onChange={(e) => setAddressDraft({ ...addressDraft, line1: e.target.value })}
              />
              <FormInput
                label="Tax ID (GSTIN)"
                value={taxIdDraft}
                onChange={(e) => setTaxIdDraft(e.target.value)}
              />
              <FormInput
                label="Phone"
                value={phoneDraft}
                onChange={(e) => setPhoneDraft(e.target.value)}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
              <FormInput
                label="City"
                value={addressDraft.city}
                onChange={(e) => setAddressDraft({ ...addressDraft, city: e.target.value })}
              />
              <FormInput
                label="State"
                value={addressDraft.state}
                onChange={(e) => setAddressDraft({ ...addressDraft, state: e.target.value })}
              />
              <FormInput
                label="Postal Code"
                value={addressDraft.postal_code}
                onChange={(e) => setAddressDraft({ ...addressDraft, postal_code: e.target.value })}
              />
              <FormInput
                label="Country"
                value={addressDraft.country}
                onChange={(e) => setAddressDraft({ ...addressDraft, country: e.target.value })}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button type="button" variant="outline" onClick={() => setEditingAddress(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" isLoading={isSavingAddress}>
                <Check size={14} />
                Save Address
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* Relational Tabs: Subscriptions | Invoices | Payments */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--color-hairline)', paddingBottom: 10 }}>
        <Button
          variant={activeTab === 'subscriptions' ? 'ink' : 'sand'}
          onClick={() => setActiveTab('subscriptions')}
        >
          Subscriptions ({subscriptions.length})
        </Button>
        <Button
          variant={activeTab === 'invoices' ? 'ink' : 'sand'}
          onClick={() => setActiveTab('invoices')}
        >
          Invoices ({invoices.length})
        </Button>
        <Button
          variant={activeTab === 'payments' ? 'ink' : 'sand'}
          onClick={() => setActiveTab('payments')}
        >
          Payments ({payments.length})
        </Button>
      </div>

      {activeTab === 'subscriptions' ? (
        <DataTable
          columns={subColumns}
          rows={subscriptions}
          rowKey={(s) => s.id}
          onRowClick={(s) => navigate(`/subscriptions/${s.id}`)}
          emptyTitle="No subscriptions yet"
          emptyDescription="Create a draft subscription or generate a quotation from a template for this customer."
        />
      ) : activeTab === 'invoices' ? (
        <DataTable
          columns={invColumns}
          rows={invoices}
          rowKey={(i) => i.id}
          onRowClick={(i) => navigate(`/invoices/${i.id}`)}
          emptyTitle="No invoices issued"
          emptyDescription="Invoices appear here once subscriptions run through a billing cycle."
        />
      ) : (
        <DataTable
          columns={payColumns}
          rows={payments}
          rowKey={(p) => p.id}
          emptyTitle="No payments recorded"
          emptyDescription="Recorded settlements and reversals for this customer appear here."
        />
      )}

      <ConfirmModal
        isOpen={confirmArchive}
        title={customer.status === 'active' ? 'Soft-Delete Customer?' : 'Reactivate Customer?'}
        description={
          customer.status === 'active'
            ? 'Soft-deleting marks this customer Inactive while keeping all historic subscriptions, invoices, and payments intact for audit compliance.'
            : 'Reactivating restores this customer for new quotations and subscriptions.'
        }
        confirmLabel={customer.status === 'active' ? 'Mark Inactive' : 'Reactivate'}
        destructive={customer.status === 'active'}
        onConfirm={() => void handleToggleStatus()}
        onCancel={() => setConfirmArchive(false)}
      />
    </div>
  );
};
