import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Boxes,
  CreditCard,
  FileSpreadsheet,
  FileText,
  History,
  Layers,
  LayoutDashboard,
  Percent,
  Receipt,
  Repeat,
  Search,
  Settings,
  Shield,
  Users,
  X,
} from 'lucide-react';
import { apiRequest } from '../../api/client';
import { StatusChip } from '../chips/StatusChip';
import type { Customer, Invoice, PaginatedResponse, Subscription } from '../../types/domain';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  isAdmin: boolean;
}

interface PaletteEntry {
  id: string;
  group: 'Navigation' | 'Subscriptions' | 'Invoices' | 'Customers';
  title: string;
  subtitle: string;
  badge?: string;
  icon: React.ReactNode;
  to: string;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  isAdmin,
}) => {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const [subs, setSubs] = useState<Subscription[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setActiveIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 20);

    Promise.all([
      apiRequest<PaginatedResponse<Subscription>>('/subscriptions?page=1&page_size=25')
        .then((r) => r.items)
        .catch(() => [] as Subscription[]),
      apiRequest<PaginatedResponse<Invoice>>('/invoices?page=1&page_size=25')
        .then((r) => r.items)
        .catch(() => [] as Invoice[]),
      apiRequest<PaginatedResponse<Customer>>('/customers?page=1&page_size=25')
        .then((r) => r.items)
        .catch(() => [] as Customer[]),
    ]).then(([s, i, c]) => {
      setSubs(s);
      setInvoices(i);
      setCustomers(c);
    });
  }, [isOpen]);

  const allEntries = useMemo<PaletteEntry[]>(() => {
    const navItems: PaletteEntry[] = [
      {
        id: 'nav-dashboard',
        group: 'Navigation',
        title: 'Finance Dashboard',
        subtitle: 'Active subscriptions, MRR/ARR, revenue & overdue summary',
        icon: <LayoutDashboard size={15} />,
        to: '/dashboard',
      },
      {
        id: 'nav-subscriptions',
        group: 'Navigation',
        title: 'Subscriptions',
        subtitle: 'Manage Draft -> Quotation -> Confirmed -> Active -> Closed lifecycle',
        icon: <Repeat size={15} />,
        to: '/subscriptions',
      },
      {
        id: 'nav-templates',
        group: 'Navigation',
        title: 'Quotation Templates',
        subtitle: 'Reusable plan & product line bundles for 1-click quotes',
        icon: <FileSpreadsheet size={15} />,
        to: '/quotation-templates',
      },
      {
        id: 'nav-customers',
        group: 'Navigation',
        title: 'Customers',
        subtitle: 'Customer directory, GSTIN, billing addresses & history',
        icon: <Users size={15} />,
        to: '/customers',
      },
      {
        id: 'nav-invoices',
        group: 'Navigation',
        title: 'Invoices & Billing Day',
        subtitle: 'Draft -> Confirmed -> Paid invoices, PDF export & batch billing',
        icon: <FileText size={15} />,
        to: '/invoices',
      },
      {
        id: 'nav-payments',
        group: 'Navigation',
        title: 'Payments Register',
        subtitle: 'Record customer payments by method, date & reference',
        icon: <CreditCard size={15} />,
        to: '/payments',
      },
      {
        id: 'nav-overdue',
        group: 'Navigation',
        title: 'Overdue & Aging Dunning',
        subtitle: 'Chase unpaid overdue invoices before they turn into lost revenue',
        icon: <AlertTriangle size={15} />,
        to: '/overdue',
      },
      {
        id: 'nav-products',
        group: 'Navigation',
        title: 'Products & Variants',
        subtitle: 'Software, add-ons & brand variants (e.g. Odoo +560)',
        icon: <Boxes size={15} />,
        to: '/products',
      },
      {
        id: 'nav-plans',
        group: 'Navigation',
        title: 'Plans & Behavior Flags',
        subtitle: 'Daily, weekly, monthly, yearly plans with pause/close/renew flags',
        icon: <Layers size={15} />,
        to: '/plans',
      },
      {
        id: 'nav-taxes',
        group: 'Navigation',
        title: 'Tax Rules',
        subtitle: 'Automatic percentage & fixed tax calculation rules',
        icon: <Receipt size={15} />,
        to: '/taxes',
      },
      {
        id: 'nav-reports',
        group: 'Navigation',
        title: 'Reports & CSV Exports',
        subtitle: 'Filterable subscription & monthly revenue reports',
        icon: <BarChart3 size={15} />,
        to: '/reports',
      },
    ];

    if (isAdmin) {
      navItems.push(
        {
          id: 'nav-discounts',
          group: 'Navigation',
          title: 'Discount Rules',
          subtitle: 'Fixed or percentage discounts for products or whole subscriptions',
          icon: <Percent size={15} />,
          to: '/discounts',
        },
        {
          id: 'nav-staff',
          group: 'Navigation',
          title: 'Internal Staff Directory',
          subtitle: 'Provision internal staff accounts & manage RBAC',
          icon: <Shield size={15} />,
          to: '/staff',
        },
        {
          id: 'nav-audit',
          group: 'Navigation',
          title: 'Audit Log',
          subtitle: 'Before/After JSON ledger audit trail',
          icon: <History size={15} />,
          to: '/audit-logs',
        },
        {
          id: 'nav-settings',
          group: 'Navigation',
          title: 'System Settings',
          subtitle: 'Organization profile, currency, prefixes & dunning cadence',
          icon: <Settings size={15} />,
          to: '/settings',
        }
      );
    }

    const subEntries: PaletteEntry[] = subs.slice(0, 8).map((s) => ({
      id: `sub-${s.id}`,
      group: 'Subscriptions',
      title: `${s.number} · ${s.customer_name}`,
      subtitle: `${s.plan_name} (${s.billing_period}) · ${s.currency} ${s.total}`,
      badge: s.status,
      icon: <Repeat size={14} />,
      to: `/subscriptions/${s.id}`,
    }));

    const invEntries: PaletteEntry[] = invoices.slice(0, 8).map((inv) => ({
      id: `inv-${inv.id}`,
      group: 'Invoices',
      title: `${inv.number} · ${inv.customer_name}`,
      subtitle: `Total ${inv.currency} ${inv.total} · Balance ${inv.currency} ${inv.balance}`,
      badge: inv.status,
      icon: <FileText size={14} />,
      to: `/invoices/${inv.id}`,
    }));

    const custEntries: PaletteEntry[] = customers.slice(0, 8).map((c) => ({
      id: `cust-${c.id}`,
      group: 'Customers',
      title: c.company_name,
      subtitle: `${c.name} · ${c.email}`,
      badge: c.status,
      icon: <Users size={14} />,
      to: `/customers/${c.id}`,
    }));

    return [...navItems, ...subEntries, ...invEntries, ...custEntries];
  }, [customers, invoices, isAdmin, subs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allEntries.slice(0, 14);
    return allEntries
      .filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.subtitle.toLowerCase().includes(q) ||
          e.group.toLowerCase().includes(q) ||
          (e.badge ?? '').toLowerCase().includes(q)
      )
      .slice(0, 16);
  }, [allEntries, query]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) =>
          filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length
        );
      } else if (e.key === 'Enter' && filtered[activeIndex]) {
        e.preventDefault();
        navigate(filtered[activeIndex].to);
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, filtered, isOpen, navigate, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Quick Navigation & Search"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-panel" style={{ maxWidth: 620 }}>
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--color-hairline)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Search size={17} style={{ color: 'var(--color-ink-mute-2)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="search"
            aria-label="Global command search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Jump to any page, subscription (SUB-...), invoice (INV-...), or customer…"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              fontSize: 15,
              backgroundColor: 'transparent',
              color: 'var(--color-ink)',
            }}
          />
          <button
            type="button"
            className="btn btn-secondary-sand"
            onClick={onClose}
            style={{ padding: 5 }}
            aria-label="Close command palette"
          >
            <X size={15} />
          </button>
        </div>

        <div
          style={{
            maxHeight: 420,
            overflowY: 'auto',
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center' }} className="type-caption">
              No matching pages, subscriptions, invoices, or customers found.
            </div>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                className={`cmdk-item ${idx === activeIndex ? 'cmdk-item-active' : ''}`.trim()}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => {
                  navigate(item.to);
                  onClose();
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ color: 'var(--color-ink-mute)', flexShrink: 0 }}>{item.icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>{item.title}</span>
                      {item.badge ? <StatusChip status={item.badge} /> : null}
                    </div>
                    <div
                      className="type-caption"
                      style={{
                        fontSize: 12,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {item.subtitle}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <span className="eyebrow-cap" style={{ fontSize: 9 }}>
                    {item.group}
                  </span>
                  <ArrowRight size={13} style={{ color: 'var(--color-ink-mute-2)' }} />
                </div>
              </button>
            ))
          )}
        </div>

        <div
          style={{
            padding: '8px 16px',
            borderTop: '1px solid var(--color-hairline)',
            backgroundColor: 'var(--color-canvas-sand)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span className="type-caption" style={{ fontSize: 11 }}>
            Use <span className="kbd-chip">↑</span> <span className="kbd-chip">↓</span> to navigate ·{' '}
            <span className="kbd-chip">Enter</span> to open · <span className="kbd-chip">Esc</span> to dismiss
          </span>
          <span className="type-caption" style={{ fontSize: 11 }}>
            SSVN Systems Quick Jump
          </span>
        </div>
      </div>
    </div>
  );
};

