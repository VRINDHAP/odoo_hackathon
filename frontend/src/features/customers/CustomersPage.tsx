import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, UserCheck } from 'lucide-react';
import { apiRequest, ApiClientError } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import { Button, FormInput, Modal } from '../../components/forms/Primitives';
import { DataTable, type DataColumn } from '../../components/tables/DataTable';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../hooks/useToast';
import type { Customer, PaginatedResponse } from '../../types/domain';
import { formatDate } from '../../utils/dates';
import {
  isValidEmail,
  isValidPhone,
  isValidPostalCode,
  isValidTaxId,
  normalizeEmail,
} from '../../utils/validation';

/**
 * FE-3.1 (Part A): Customer Directory Screen [SPEC.md §2, §5.2, §12.2, §16]
 * - Accessible to Admin & Internal Staff
 * - 300ms debounced search, active/inactive status filter, soft-deleted badge
 */
export const CustomersPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const debouncedSearch = useDebounce(search, 300);

  // Create Customer Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [taxId, setTaxId] = useState('');
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  const loadCustomers = useCallback(async () => {
    setIsLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        page_size: '25',
      });
      if (debouncedSearch) qs.set('search', debouncedSearch);
      if (statusFilter) qs.set('status', statusFilter);

      const res = await apiRequest<PaginatedResponse<Customer>>(`/customers?${qs.toString()}`);
      setCustomers(res.items);
      setTotalPages(res.total_pages);
      setTotal(res.total);
    } catch {
      showToast('Failed to load customer directory', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, page, showToast, statusFilter]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Primary contact name is required.';
    if (!companyName.trim()) errs.company_name = 'Company name is required.';
    if (!isValidEmail(email)) errs.email = 'Enter a valid billing email.';
    if (phone.trim() && !isValidPhone(phone)) {
      errs.phone = 'Enter a valid phone number (7–15 digits).';
    }
    if (taxId.trim() && !isValidTaxId(taxId)) {
      errs.tax_id = 'Tax ID / GSTIN must be 6–20 alphanumeric characters.';
    }
    if (postalCode.trim() && !isValidPostalCode(postalCode)) {
      errs.postal_code = 'Enter a valid 4–10 character postal code.';
    }
    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      return;
    }

    setFormErrors({});
    setIsSaving(true);
    try {
      const created = await apiRequest<Customer>('/customers', {
        method: 'POST',
        body: {
          name: name.trim(),
          company_name: companyName.trim(),
          email: normalizeEmail(email),
          phone: phone.trim(),
          tax_id: taxId.trim(),
          billing_address: {
            line1: line1.trim(),
            city: city.trim(),
            state: stateName.trim(),
            postal_code: postalCode.trim(),
            country: 'India',
          },
        },
      });
      showToast(`Created customer "${created.company_name}"`, 'success');
      setIsModalOpen(false);
      navigate(`/customers/${created.id}`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormErrors(err.toFieldMap());
        showToast(err.message, 'error');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const columns: DataColumn<Customer>[] = [
    {
      key: 'company',
      header: 'Organization & Contact',
      sortValue: (c) => c.company_name,
      render: (c) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>{c.company_name}</span>
          <span className="type-caption">
            {c.name} · {c.email}
          </span>
        </div>
      ),
    },
    {
      key: 'tax_id',
      header: 'Tax ID (GSTIN)',
      render: (c) => <span className="mono-text">{c.tax_id || '—'}</span>,
    },
    {
      key: 'location',
      header: 'Billing City',
      sortValue: (c) => c.billing_address.city,
      render: (c) => (
        <span className="type-caption">
          {c.billing_address.city
            ? `${c.billing_address.city}, ${c.billing_address.state}`
            : '—'}
        </span>
      ),
    },
    {
      key: 'portal',
      header: 'Portal Access',
      render: (c) =>
        c.portal_user_linked ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--chip-active-text)' }}>
            <UserCheck size={13} />
            Linked
          </span>
        ) : (
          <span className="type-caption">Unlinked</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (c) => c.status,
      render: (c) => (
        <StatusChip
          status={c.status === 'inactive' ? 'Inactive (Archived)' : 'Active'}
          variant={c.status === 'active' ? 'active' : 'draft'}
        />
      ),
    },
    {
      key: 'created_at',
      header: 'Onboarded',
      align: 'right',
      render: (c) => <span className="type-caption">{formatDate(c.created_at)}</span>,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">CRM &amp; Billing Accounts</span>
          <h1 className="type-display-md">Customer Directory</h1>
          <p className="type-caption">
            Manage customer organizations, tax identifiers, billing addresses, and linked subscription ledgers.
          </p>
        </div>

        <div className="page-header-actions">
          <Button variant="primary" onClick={() => setIsModalOpen(true)}>
            <Plus size={15} />
            New Customer
          </Button>
        </div>
      </header>

      <DataTable
        columns={columns}
        rows={customers}
        rowKey={(c) => c.id}
        isLoading={isLoading}
        onRowClick={(c) => navigate(`/customers/${c.id}`)}
        page={page}
        totalPages={totalPages}
        totalItems={total}
        onPageChange={setPage}
        toolbar={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: 1 }}>
              <input
                type="search"
                className="form-input"
                placeholder="Search company, contact, email, or GSTIN…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                style={{ maxWidth: 340 }}
              />
              <select
                className="form-select"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                style={{ maxWidth: 180 }}
                aria-label="Filter by customer status"
              >
                <option value="">All Statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive (Soft-Deleted)</option>
              </select>
            </div>
            <span className="type-caption">{total} accounts</span>
          </div>
        }
        emptyTitle="No customers match your filter"
        emptyDescription="Create a customer profile to start issuing quotations and recurring subscriptions."
        emptyAction={
          <Button variant="primary" onClick={() => setIsModalOpen(true)}>
            New Customer
          </Button>
        }
      />

      <Modal
        isOpen={isModalOpen}
        title="Create Customer Profile"
        eyebrow="POST /api/v1/customers"
        onClose={() => setIsModalOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreateCustomer} isLoading={isSaving}>
              Create Customer
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateCustomer} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FormInput
              label="Company Name"
              placeholder="Aether Cloud Pvt Ltd"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              error={formErrors.company_name}
            />
            <FormInput
              label="Primary Contact Name"
              placeholder="Karthik Subramanian"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={formErrors.name}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FormInput
              label="Billing Email"
              type="email"
              placeholder="ap@aethercloud.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={formErrors.email}
            />
            <FormInput
              label="Phone"
              placeholder="+91 98450 00000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              error={formErrors.phone}
            />
          </div>

          <FormInput
            label="Tax ID / GSTIN"
            placeholder="29AAACA1122B1Z5"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            error={formErrors.tax_id}
          />

          <FormInput
            label="Street Address"
            placeholder="100 Feet Road, HAL 2nd Stage"
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <FormInput label="City" placeholder="Bengaluru" value={city} onChange={(e) => setCity(e.target.value)} />
            <FormInput label="State" placeholder="Karnataka" value={stateName} onChange={(e) => setStateName(e.target.value)} />
            <FormInput
              label="Postal Code"
              placeholder="560038"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              error={formErrors.postal_code}
            />
          </div>
        </form>
      </Modal>
    </div>
  );
};

