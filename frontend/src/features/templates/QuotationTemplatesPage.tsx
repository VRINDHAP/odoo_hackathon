import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FilePlus2, Plus, Trash2 } from 'lucide-react';
import { apiRequest, ApiClientError } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import {
  Button,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
} from '../../components/forms/Primitives';
import { useToast } from '../../hooks/useToast';
import type {
  Customer,
  PaginatedResponse,
  Plan,
  Product,
  QuotationTemplate,
  QuotationTemplateLine,
  Subscription,
  SystemSettings,
} from '../../types/domain';
import { formatMoney, parseMoney, roundHalfUp, toFixedMoney } from '../../utils/money';

/**
 * FE-3.2: Quotation Templates Builder & One-Click Quotation Generator
 * [SPEC.md §2, §5.5, §12.2 | TASKS.md FE-3.2]
 */
export const QuotationTemplatesPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [templates, setTemplates] = useState<QuotationTemplate[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [currency, setCurrency] = useState('INR');
  const [isLoading, setIsLoading] = useState(true);

  // Create Template Modal
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [tplName, setTplName] = useState('');
  const [validityDays, setValidityDays] = useState('15');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<QuotationTemplateLine[]>([]);
  const [builderError, setBuilderError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // One-Click Create Quotation Customer Selector Modal
  const [quotingTemplate, setQuotingTemplate] = useState<QuotationTemplate | null>(null);
  const [targetCustomerId, setTargetCustomerId] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [tpls, planList, prodList, custPage, settings] = await Promise.all([
        apiRequest<QuotationTemplate[]>('/quotation-templates'),
        apiRequest<Plan[]>('/plans'),
        apiRequest<Product[]>('/products'),
        apiRequest<PaginatedResponse<Customer>>('/customers?page=1&page_size=100'),
        apiRequest<SystemSettings>('/settings'),
      ]);
      setTemplates(tpls);
      setPlans(planList);
      setProducts(prodList);
      const activeCustomers = custPage.items.filter((c) => c.status === 'active');
      setCustomers(activeCustomers);
      if (activeCustomers[0]) setTargetCustomerId(activeCustomers[0].id);
      setCurrency(settings.currency);
    } catch {
      showToast('Failed to load quotation templates', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const openBuilder = () => {
    const defaultPlan = plans[0];
    const defaultProd = products[0];
    setTplName('');
    setValidityDays('15');
    setSelectedPlanId(defaultPlan?.id ?? '');
    setNotes('');
    setBuilderError('');
    setLines(
      defaultProd
        ? [
            {
              id: `line-${Date.now()}`,
              product_id: defaultProd.id,
              product_name: defaultProd.name,
              variant_id: null,
              variant_label: null,
              quantity: defaultPlan?.min_quantity ?? 1,
              unit_price: defaultProd.sales_price,
            },
          ]
        : []
    );
    setIsBuilderOpen(true);
  };

  const addLineItem = () => {
    const prod = products[0];
    if (!prod) return;
    setLines((prev) => [
      ...prev,
      {
        id: `line-${Date.now()}-${prev.length}`,
        product_id: prod.id,
        product_name: prod.name,
        variant_id: null,
        variant_label: null,
        quantity: 1,
        unit_price: prod.sales_price,
      },
    ]);
  };

  const updateLineProduct = (index: number, productId: string) => {
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;
    setLines((prev) =>
      prev.map((line, i) =>
        i === index
          ? {
              ...line,
              product_id: prod.id,
              product_name: prod.name,
              variant_id: null,
              variant_label: null,
              unit_price: prod.sales_price,
            }
          : line
      )
    );
  };

  const updateLineVariant = (index: number, variantId: string) => {
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const prod = products.find((p) => p.id === line.product_id);
        if (!prod) return line;
        if (!variantId) {
          return {
            ...line,
            variant_id: null,
            variant_label: null,
            unit_price: prod.sales_price,
          };
        }
        const v = prod.variants.find((vr) => vr.id === variantId);
        const effective = roundHalfUp(parseMoney(prod.sales_price) + parseMoney(v?.extra_price));
        return {
          ...line,
          variant_id: variantId,
          variant_label: v ? `${v.attribute}: ${v.value}` : null,
          unit_price: toFixedMoney(effective),
        };
      })
    );
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tplName.trim()) {
      setBuilderError('Template name is required.');
      return;
    }
    if (!selectedPlanId) {
      setBuilderError('Select a subscription plan.');
      return;
    }
    if (lines.length === 0) {
      setBuilderError('Add at least one line item to the quotation template.');
      return;
    }

    setBuilderError('');
    setIsSaving(true);
    try {
      const created = await apiRequest<QuotationTemplate>('/quotation-templates', {
        method: 'POST',
        body: {
          name: tplName.trim(),
          validity_days: Math.max(1, Number.parseInt(validityDays, 10) || 15),
          plan_id: selectedPlanId,
          notes: notes.trim(),
          lines,
        },
      });
      setTemplates((prev) => [created, ...prev]);
      setIsBuilderOpen(false);
      showToast(`Saved template "${created.name}"`, 'success');
    } catch (err) {
      showToast(err instanceof ApiClientError ? err.message : 'Failed to create template', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateQuotation = async () => {
    if (!quotingTemplate) return;
    setIsGenerating(true);
    try {
      const draftSub = await apiRequest<Subscription>(
        `/quotation-templates/${quotingTemplate.id}/create-quotation`,
        {
          method: 'POST',
          body: { customer_id: targetCustomerId },
        }
      );
      showToast(`Generated draft ${draftSub.number}`, 'success');
      setQuotingTemplate(null);
      navigate(`/subscriptions/${draftSub.id}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to generate quotation', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">Sales Enablement · Admin &amp; Staff</span>
          <h1 className="type-display-md">Quotation Templates</h1>
          <p className="type-caption">
            Standardized product bundles with validity windows and one-click Draft Subscription generation.
          </p>
        </div>

        <div className="page-header-actions">
          <Button variant="primary" onClick={openBuilder}>
            <Plus size={15} />
            New Template
          </Button>
        </div>
      </header>

      {isLoading ? (
        <div className="tile-mosaic-2x2">
          <div className="product-tile">
            <div className="skeleton-line" style={{ width: '45%', marginBottom: 12 }} />
            <div className="skeleton-line" style={{ width: '75%' }} />
          </div>
          <div className="product-tile">
            <div className="skeleton-line" style={{ width: '45%', marginBottom: 12 }} />
            <div className="skeleton-line" style={{ width: '75%' }} />
          </div>
        </div>
      ) : (
        <div className="tile-mosaic-2x2">
          {templates.map((tpl) => {
            const estSubtotal = tpl.lines.reduce(
              (acc, l) => roundHalfUp(acc + l.quantity * parseMoney(l.unit_price)),
              0
            );
            return (
              <article
                key={tpl.id}
                className="product-tile"
                style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 18 }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <StatusChip status={tpl.plan_name} variant="confirmed" showDot={false} />
                    <span className="type-caption">Valid {tpl.validity_days} days</span>
                  </div>
                  <h2 className="type-heading">{tpl.name}</h2>
                  <p className="type-caption">{tpl.notes || 'Standard recurring quotation bundle.'}</p>

                  <div
                    style={{
                      marginTop: 4,
                      borderTop: '1px solid var(--color-hairline)',
                      paddingTop: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    {tpl.lines.map((line) => (
                      <div
                        key={line.id}
                        style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}
                      >
                        <span>
                          {line.product_name}
                          {line.variant_label ? ` (${line.variant_label})` : ''} × {line.quantity}
                        </span>
                        <span className="money-cell">
                          {formatMoney(line.quantity * parseMoney(line.unit_price), currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    paddingTop: 14,
                    borderTop: '1px solid var(--color-hairline)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <span className="eyebrow-cap">Bundle Subtotal</span>
                    <div>{formatMoney(estSubtotal, currency)}</div>
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setQuotingTemplate(tpl);
                      if (!targetCustomerId && customers[0]) setTargetCustomerId(customers[0].id);
                    }}
                  >
                    <FilePlus2 size={14} />
                    Create Quotation
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Template Builder Modal */}
      <Modal
        isOpen={isBuilderOpen}
        title="Build Quotation Template"
        eyebrow="POST /api/v1/quotation-templates"
        maxWidth={680}
        onClose={() => setIsBuilderOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setIsBuilderOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveTemplate} isLoading={isSaving}>
              Save Template
            </Button>
          </>
        }
      >
        <form onSubmit={handleSaveTemplate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {builderError ? <div className="form-error-text">{builderError}</div> : null}

          <FormInput
            label="Template Name"
            placeholder="Enterprise Finance Stack (20 Seats)"
            value={tplName}
            onChange={(e) => setTplName(e.target.value)}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <FormSelect
              label="Target Subscription Plan"
              value={selectedPlanId}
              onChange={(e) => setSelectedPlanId(e.target.value)}
              options={plans.map((p) => ({
                value: p.id,
                label: `${p.name} (${p.billing_period} · min qty ${p.min_quantity})`,
              }))}
            />
            <FormInput
              label="Quote Validity (Days)"
              type="number"
              min="1"
              value={validityDays}
              onChange={(e) => setValidityDays(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="eyebrow-cap">Template Line Items</span>
              <Button type="button" variant="sand" onClick={addLineItem}>
                <Plus size={13} />
                Add Line
              </Button>
            </div>

            {lines.map((line, index) => {
              const prod = products.find((p) => p.id === line.product_id);
              return (
                <div
                  key={line.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1.4fr 80px 120px 36px',
                    gap: 8,
                    alignItems: 'end',
                    padding: 10,
                    borderRadius: 'var(--rounded-md)',
                    backgroundColor: 'var(--color-canvas-sand)',
                  }}
                >
                  <FormSelect
                    label="Product"
                    value={line.product_id}
                    onChange={(e) => updateLineProduct(index, e.target.value)}
                    options={products.map((p) => ({ value: p.id, label: p.name }))}
                  />
                  <FormSelect
                    label="Variant"
                    value={line.variant_id ?? ''}
                    onChange={(e) => updateLineVariant(index, e.target.value)}
                    options={[
                      { value: '', label: 'Base SKU' },
                      ...(prod?.variants.map((v) => ({
                        value: v.id,
                        label: `${v.attribute}: ${v.value}`,
                      })) ?? []),
                    ]}
                  />
                  <FormInput
                    label="Qty"
                    type="number"
                    min="1"
                    value={String(line.quantity)}
                    onChange={(e) => {
                      const q = Math.max(1, Number.parseInt(e.target.value, 10) || 1);
                      setLines((prev) =>
                        prev.map((l, i) => (i === index ? { ...l, quantity: q } : l))
                      );
                    }}
                  />
                  <FormInput
                    label={`Unit (${currency})`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.unit_price}
                    onChange={(e) => {
                      const u = e.target.value;
                      setLines((prev) =>
                        prev.map((l, i) => (i === index ? { ...l, unit_price: u } : l))
                      );
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-danger-outline"
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                    aria-label="Remove line"
                    style={{ padding: 8 }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          <FormTextarea
            label="Default Terms & Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </form>
      </Modal>

      {/* One-Click Create Quotation Modal */}
      <Modal
        isOpen={Boolean(quotingTemplate)}
        title="Generate Draft Quotation"
        eyebrow="One-Click Template Instantiation"
        onClose={() => setQuotingTemplate(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setQuotingTemplate(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void handleGenerateQuotation()} isLoading={isGenerating}>
              Generate &amp; Open Draft →
            </Button>
          </>
        }
      >
        <p className="type-caption">
          Select the customer organization to instantiate{' '}
          <strong>{quotingTemplate?.name}</strong> into an editable Draft Subscription.
        </p>
        <FormSelect
          label="Customer Account"
          value={targetCustomerId}
          onChange={(e) => setTargetCustomerId(e.target.value)}
          options={customers.map((c) => ({
            value: c.id,
            label: `${c.company_name} (${c.email})`,
          }))}
        />
      </Modal>
    </div>
  );
};
