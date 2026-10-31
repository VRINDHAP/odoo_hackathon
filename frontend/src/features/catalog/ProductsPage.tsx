import React, { useCallback, useEffect, useState } from 'react';
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { apiRequest, ApiClientError } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import {
  Button,
  ConfirmModal,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  SlideOverDrawer,
} from '../../components/forms/Primitives';
import { DataTable, type DataColumn } from '../../components/tables/DataTable';
import { useAuth } from '../../hooks/useAuth';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../hooks/useToast';
import type { Product, ProductType, ProductVariant, SystemSettings, TaxRule } from '../../types/domain';
import { formatMoney, parseMoney, roundHalfUp, toFixedMoney } from '../../utils/money';

/**
 * FE-2.1: Products & Variants Management Screen [SPEC.md §2, §5.3, §12.2]
 * - Admin: full CRUD on products, add variants in drawer, view Cost Price & Margin (sales - cost)
 * - Staff: strict read-only view, Cost Price & Margin hidden
 * - Effective variant unit price = product.sales_price + variant.extra_price
 */
export const ProductsPage: React.FC = () => {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();

  const [products, setProducts] = useState<Product[]>([]);
  const [taxes, setTaxes] = useState<TaxRule[]>([]);
  const [currency, setCurrency] = useState('INR');
  const [isLoading, setIsLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  // Create / Edit Product Modal (Admin Only)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [name, setName] = useState('');
  const [prodType, setProdType] = useState<ProductType>('software');
  const [salesPrice, setSalesPrice] = useState('0.00');
  const [costPrice, setCostPrice] = useState('0.00');
  const [taxId, setTaxId] = useState('');
  const [notes, setNotes] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Delete Confirmation Modal (Admin Only)
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Variant Manager Slide-Over Drawer
  const [drawerProduct, setDrawerProduct] = useState<Product | null>(null);
  const [varAttr, setVarAttr] = useState('');
  const [varValue, setVarValue] = useState('');
  const [varExtraPrice, setVarExtraPrice] = useState('0.00');
  const [varErrors, setVarErrors] = useState<Record<string, string>>({});
  const [isAddingVariant, setIsAddingVariant] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [prods, taxList, settings] = await Promise.all([
        apiRequest<Product[]>('/products'),
        apiRequest<TaxRule[]>('/taxes'),
        apiRequest<SystemSettings>('/settings'),
      ]);
      setProducts(prods);
      setTaxes(taxList);
      setCurrency(settings.currency);
    } catch {
      showToast('Failed to load product catalog', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openCreateModal = () => {
    setEditingProduct(null);
    setName('');
    setProdType('software');
    setSalesPrice('1000.00');
    setCostPrice('300.00');
    setTaxId(taxes[0]?.id ?? '');
    setNotes('');
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setName(product.name);
    setProdType(product.type);
    setSalesPrice(product.sales_price);
    setCostPrice(product.cost_price);
    setTaxId(product.tax_id ?? '');
    setNotes(product.notes);
    setFormErrors({});
    setIsModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Product name is required.';
    const salesNum = Number.parseFloat(salesPrice);
    const costNum = Number.parseFloat(costPrice);
    if (Number.isNaN(salesNum) || salesNum < 0) {
      errs.sales_price = 'Sales price must be 0.00 or higher.';
    }
    if (Number.isNaN(costNum) || costNum < 0) {
      errs.cost_price = 'Cost price cannot be negative.';
    }
    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      return;
    }

    setFormErrors({});
    setIsSaving(true);
    try {
      const payload = {
        name: name.trim(),
        type: prodType,
        sales_price: toFixedMoney(salesNum),
        cost_price: toFixedMoney(costNum),
        tax_id: taxId || null,
        notes: notes.trim(),
      };

      if (editingProduct) {
        const updated = await apiRequest<Product>(`/products/${editingProduct.id}`, {
          method: 'PATCH',
          body: payload,
        });
        setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        if (drawerProduct?.id === updated.id) setDrawerProduct(updated);
        showToast(`Updated "${updated.name}"`, 'success');
      } else {
        const created = await apiRequest<Product>('/products', {
          method: 'POST',
          body: payload,
        });
        setProducts((prev) => [created, ...prev]);
        showToast(`Created product "${created.name}"`, 'success');
      }
      setIsModalOpen(false);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormErrors(err.toFieldMap());
        showToast(err.message, 'error');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProduct = async () => {
    if (!deletingProduct) return;
    setIsDeleting(true);
    try {
      await apiRequest<void>(`/products/${deletingProduct.id}`, { method: 'DELETE' });
      setProducts((prev) => prev.filter((p) => p.id !== deletingProduct.id));
      if (drawerProduct?.id === deletingProduct.id) setDrawerProduct(null);
      showToast(`Deleted "${deletingProduct.name}"`, 'success');
      setDeletingProduct(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAddVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!drawerProduct) return;
    const errs: Record<string, string> = {};
    if (!varAttr.trim()) errs.attribute = 'Attribute name (e.g. Brand, Edition) is required.';
    if (!varValue.trim()) errs.value = 'Attribute value (e.g. Odoo, Enterprise) is required.';
    const extraNum = Number.parseFloat(varExtraPrice);
    if (Number.isNaN(extraNum) || extraNum < 0) {
      errs.extra_price = 'Extra price cannot be negative.';
    }
    if (Object.keys(errs).length > 0) {
      setVarErrors(errs);
      return;
    }

    setVarErrors({});
    setIsAddingVariant(true);
    try {
      const createdVariant = await apiRequest<ProductVariant>(
        `/products/${drawerProduct.id}/variants`,
        {
          method: 'POST',
          body: {
            attribute: varAttr.trim(),
            value: varValue.trim(),
            extra_price: toFixedMoney(extraNum),
          },
        }
      );
      const nextProd: Product = {
        ...drawerProduct,
        variants: [...drawerProduct.variants, createdVariant],
      };
      setDrawerProduct(nextProd);
      setProducts((prev) => prev.map((p) => (p.id === nextProd.id ? nextProd : p)));
      setVarAttr('');
      setVarValue('');
      setVarExtraPrice('0.00');
      showToast(`Added variant "${createdVariant.attribute}: ${createdVariant.value}"`, 'success');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setVarErrors(err.toFieldMap());
        showToast(err.message, 'error');
      }
    } finally {
      setIsAddingVariant(false);
    }
  };

  const filteredProducts = products.filter((p) => {
    if (typeFilter && p.type !== typeFilter) return false;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      if (!`${p.name} ${p.notes} ${p.type}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const taxNameById = (id: string | null) =>
    taxes.find((t) => t.id === id)?.name ?? 'No default tax';

  const columns: DataColumn<Product>[] = [
    {
      key: 'name',
      header: 'Product SKU',
      sortValue: (p) => p.name,
      render: (p) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>{p.name}</span>
          <span className="type-caption">{p.notes || '—'}</span>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortValue: (p) => p.type,
      render: (p) => <StatusChip status={p.type} variant="neutral" showDot={false} />,
    },
    {
      key: 'tax',
      header: 'Default Tax',
      render: (p) => <span className="type-caption">{taxNameById(p.tax_id)}</span>,
    },
    {
      key: 'variants',
      header: 'Variants',
      render: (p) => (
        <Button
          variant="sand"
          onClick={(e) => {
            e.stopPropagation();
            setDrawerProduct(p);
          }}
        >
          <Layers size={13} />
          {p.variants.length} {p.variants.length === 1 ? 'variant' : 'variants'}
        </Button>
      ),
    },
    {
      key: 'sales_price',
      header: 'Sales Price',
      align: 'right',
      sortValue: (p) => parseMoney(p.sales_price),
      render: (p) => formatMoney(p.sales_price, currency),
    },
    ...(isAdmin
      ? ([
          {
            key: 'cost_price',
            header: 'Cost Price',
            align: 'right' as const,
            sortValue: (p: Product) => parseMoney(p.cost_price),
            render: (p: Product) => (
              <span style={{ color: 'var(--color-ink-mute)' }}>
                {formatMoney(p.cost_price, currency)}
              </span>
            ),
          },
          {
            key: 'margin',
            header: 'Unit Margin',
            align: 'right' as const,
            sortValue: (p: Product) => parseMoney(p.sales_price) - parseMoney(p.cost_price),
            render: (p: Product) => {
              const sales = parseMoney(p.sales_price);
              const cost = parseMoney(p.cost_price);
              const margin = roundHalfUp(sales - cost);
              const pct = sales > 0 ? Math.round((margin / sales) * 100) : 0;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <span style={{ color: margin >= 0 ? 'var(--chip-active-text)' : 'var(--color-danger)' }}>
                    {formatMoney(margin, currency)}
                  </span>
                  <span className="type-caption" style={{ fontSize: 11 }}>
                    {pct}% gross
                  </span>
                </div>
              );
            },
          },
          {
            key: 'actions',
            header: 'Actions',
            align: 'right' as const,
            render: (p: Product) => (
              <div style={{ display: 'inline-flex', gap: 6 }}>
                <Button
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditModal(p);
                  }}
                  aria-label={`Edit ${p.name}`}
                >
                  <Pencil size={13} />
                  Edit
                </Button>
                <Button
                  variant="danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeletingProduct(p);
                  }}
                  aria-label={`Delete ${p.name}`}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            ),
          },
        ] satisfies DataColumn<Product>[])
      : []),
  ];

  const previewSales = parseMoney(salesPrice);
  const previewCost = parseMoney(costPrice);
  const previewMargin = roundHalfUp(previewSales - previewCost);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">
            Catalog Module · {isAdmin ? 'Admin Write & Margin View' : 'Staff Read-Only View'}
          </span>
          <h1 className="type-display-md">Products &amp; Variants</h1>
          <p className="type-caption">
            Recurring and one-off SKUs across software, services, add-ons, and physical hardware.
          </p>
        </div>

        {isAdmin ? (
          <div className="page-header-actions">
            <Button variant="primary" onClick={openCreateModal}>
              <Plus size={15} />
              New Product
            </Button>
          </div>
        ) : (
          <StatusChip status="Read-Only Access" variant="neutral" />
        )}
      </header>

      <DataTable
        columns={columns}
        rows={filteredProducts}
        rowKey={(p) => p.id}
        isLoading={isLoading}
        toolbar={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: 1 }}>
              <input
                type="search"
                className="form-input"
                placeholder="Search products or notes…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ maxWidth: 300 }}
              />
              <select
                className="form-select"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                style={{ maxWidth: 180 }}
                aria-label="Filter by product type"
              >
                <option value="">All Product Types</option>
                <option value="software">Software</option>
                <option value="service">Service</option>
                <option value="addon">Add-on</option>
                <option value="physical">Physical</option>
              </select>
            </div>
            <span className="type-caption">{filteredProducts.length} catalog items</span>
          </div>
        }
        emptyTitle="No catalog products found"
        emptyDescription="Add your first software, service, or hardware SKU to build plans and quotations."
        emptyAction={
          isAdmin ? (
            <Button variant="primary" onClick={openCreateModal}>
              Create Product
            </Button>
          ) : undefined
        }
      />

      {/* Admin Product Create / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        title={editingProduct ? 'Edit Product' : 'Create Catalog Product'}
        eyebrow="Catalog SKU"
        onClose={() => setIsModalOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveProduct} isLoading={isSaving}>
              {editingProduct ? 'Save Changes' : 'Create Product'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSaveProduct} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormInput
            label="Product Name"
            placeholder="Brightloop Core ERP Suite"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={formErrors.name}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormSelect
              label="Product Type"
              value={prodType}
              onChange={(e) => setProdType(e.target.value as ProductType)}
              options={[
                { value: 'software', label: 'Software' },
                { value: 'service', label: 'Service' },
                { value: 'addon', label: 'Add-on' },
                { value: 'physical', label: 'Physical' },
              ]}
            />
            <FormSelect
              label="Default Tax Rule"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              options={[
                { value: '', label: 'None' },
                ...taxes.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormInput
              label={`Sales Price (${currency})`}
              type="number"
              min="0"
              step="0.01"
              value={salesPrice}
              onChange={(e) => setSalesPrice(e.target.value)}
              error={formErrors.sales_price}
            />
            <FormInput
              label={`Internal Cost Price (${currency})`}
              type="number"
              min="0"
              step="0.01"
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
              error={formErrors.cost_price}
            />
          </div>

          <div
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--rounded-md)',
              backgroundColor: 'var(--color-canvas-sand)',
              border: '1px solid var(--color-hairline)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span className="type-caption">Calculated Admin Margin (Sales − Cost)</span>
            <span className="money-cell" style={{ color: previewMargin >= 0 ? 'var(--chip-active-text)' : 'var(--color-danger)' }}>
              {formatMoney(previewMargin, currency)}
            </span>
          </div>

          <FormTextarea
            label="Operational Notes"
            placeholder="Describe seat metering, SLA, or hardware warranty terms…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </form>
      </Modal>

      {/* Variant Manager Slide-Over Drawer */}
      <SlideOverDrawer
        isOpen={Boolean(drawerProduct)}
        title={drawerProduct ? `${drawerProduct.name}` : 'Variants'}
        eyebrow="Product Variants & Effective Pricing"
        onClose={() => setDrawerProduct(null)}
      >
        {drawerProduct ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="product-tile-compact" style={{ backgroundColor: 'var(--color-canvas-sand)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="type-caption">Base Sales Price</span>
                <span>{formatMoney(drawerProduct.sales_price, currency)}</span>
              </div>
              <p className="form-helper-text" style={{ marginTop: 4 }}>
                Effective unit price = Base Sales Price + Variant Extra Price.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span className="eyebrow-cap">Configured Variants ({drawerProduct.variants.length})</span>
              {drawerProduct.variants.length === 0 ? (
                <p className="type-caption">No variants configured for this product yet.</p>
              ) : (
                drawerProduct.variants.map((v) => {
                  const effective = roundHalfUp(
                    parseMoney(drawerProduct.sales_price) + parseMoney(v.extra_price)
                  );
                  return (
                    <div
                      key={v.id}
                      style={{
                        padding: '12px 14px',
                        borderRadius: 'var(--rounded-md)',
                        border: '1px solid var(--color-hairline)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <div>
                        <span className="eyebrow-cap" style={{ lineHeight: '14px' }}>
                          {v.attribute}
                        </span>
                        <div>{v.value}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="type-caption">+{formatMoney(v.extra_price, currency)}</div>
                        <div>Effective: {formatMoney(effective, currency)}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {isAdmin ? (
              <form
                onSubmit={handleAddVariant}
                style={{
                  paddingTop: 16,
                  borderTop: '1px solid var(--color-hairline)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <span className="eyebrow-cap">Add New Variant</span>
                <FormInput
                  label="Attribute (e.g. Brand, Edition, Region)"
                  placeholder="Brand"
                  value={varAttr}
                  onChange={(e) => setVarAttr(e.target.value)}
                  error={varErrors.attribute}
                />
                <FormInput
                  label="Attribute Value (e.g. Odoo, Enterprise)"
                  placeholder="Odoo"
                  value={varValue}
                  onChange={(e) => setVarValue(e.target.value)}
                  error={varErrors.value}
                />
                <FormInput
                  label={`Extra Price (${currency})`}
                  type="number"
                  min="0"
                  step="0.01"
                  value={varExtraPrice}
                  onChange={(e) => setVarExtraPrice(e.target.value)}
                  error={varErrors.extra_price}
                  helperText={`Resulting unit price: ${formatMoney(
                    roundHalfUp(parseMoney(drawerProduct.sales_price) + parseMoney(varExtraPrice)),
                    currency
                  )}`}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button type="submit" variant="primary" isLoading={isAddingVariant}>
                    <Plus size={14} />
                    Add Variant
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}
      </SlideOverDrawer>

      <ConfirmModal
        isOpen={Boolean(deletingProduct)}
        title="Delete Catalog Product?"
        description={`Removing "${deletingProduct?.name ?? ''}" hides it from future quotations while preserving historic subscription snapshots.`}
        confirmLabel="Delete Product"
        destructive
        isLoading={isDeleting}
        onConfirm={() => void handleDeleteProduct()}
        onCancel={() => setDeletingProduct(null)}
      />
    </div>
  );
};

