import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Boxes,
  ChevronRight,
  CreditCard,
  FileSpreadsheet,
  FileText,
  History,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Percent,
  Plus,
  Receipt,
  RefreshCw,
  Repeat,
  Search,
  Settings,
  Shield,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import { emitManualRefresh, getLastSyncTimestamp } from '../api/realtimeBus';
import { StatusChip } from '../components/chips/StatusChip';
import { Button } from '../components/forms/Primitives';
import { CommandPalette } from '../components/navigation/CommandPalette';
import { useAuth } from '../hooks/useAuth';
import { useRealtimeSync } from '../hooks/useRealtimeSync';
import type { NotificationItem } from '../types/domain';

interface NavItem {
  to: string;
  label: string;
  section: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

const OVERVIEW_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', section: 'Overview', icon: <LayoutDashboard size={16} /> },
];

const SALES_NAV: NavItem[] = [
  { to: '/customers', label: 'Customers', section: 'Sales & Subscriptions', icon: <Users size={16} /> },
  { to: '/quotation-templates', label: 'Templates', section: 'Sales & Subscriptions', icon: <FileSpreadsheet size={16} /> },
  { to: '/subscriptions', label: 'Subscriptions', section: 'Sales & Subscriptions', icon: <Repeat size={16} /> },
];

const CATALOG_NAV: NavItem[] = [
  { to: '/products', label: 'Products', section: 'Catalog & Pricing', icon: <Boxes size={16} /> },
  { to: '/plans', label: 'Plans', section: 'Catalog & Pricing', icon: <Layers size={16} /> },
  { to: '/taxes', label: 'Taxes', section: 'Catalog & Pricing', icon: <Receipt size={16} /> },
  { to: '/discounts', label: 'Discounts', section: 'Catalog & Pricing', icon: <Percent size={16} />, adminOnly: true },
];

const BILLING_NAV: NavItem[] = [
  { to: '/invoices', label: 'Invoices', section: 'Billing & Ledger', icon: <FileText size={16} /> },
  { to: '/payments', label: 'Payments', section: 'Billing & Ledger', icon: <CreditCard size={16} /> },
  { to: '/overdue', label: 'Overdue', section: 'Billing & Ledger', icon: <AlertTriangle size={16} /> },
  { to: '/reports', label: 'Reports', section: 'Billing & Ledger', icon: <BarChart3 size={16} /> },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/staff', label: 'Staff', section: 'Administration', icon: <Shield size={16} />, adminOnly: true },
  { to: '/audit-logs', label: 'Audit Log', section: 'Administration', icon: <History size={16} />, adminOnly: true },
  { to: '/settings', label: 'Settings', section: 'Administration', icon: <Settings size={16} />, adminOnly: true },
];

const ALL_NAV_ITEMS: NavItem[] = [
  ...OVERVIEW_NAV,
  ...SALES_NAV,
  ...CATALOG_NAV,
  ...BILLING_NAV,
  ...ADMIN_NAV,
];

export const WorkspaceLayout: React.FC = () => {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<string>(() => getLastSyncTimestamp());

  const loadNotifications = useCallback(() => {
    setLastSyncTime(getLastSyncTimestamp());
    apiRequest<NotificationItem[]>('/notifications')
      .then((items) => {
        setNotifications(items);
        setLastSyncTime(getLastSyncTimestamp());
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useRealtimeSync(loadNotifications, { pollIntervalMs: 30000 });

  // Global Ctrl+K / Cmd+K Quick-Jump Shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const breadcrumbs = useMemo(() => {
    const path = location.pathname;
    const matched = ALL_NAV_ITEMS.find(
      (item) => path === item.to || path.startsWith(`${item.to}/`)
    );
    if (!matched) {
      return {
        section: isAdmin ? 'Admin Console' : 'Operations',
        parent: null as { to: string; label: string } | null,
        current: 'Workspace',
      };
    }
    const isDetailView = path !== matched.to && path.startsWith(`${matched.to}/`);
    if (isDetailView) {
      return {
        section: matched.section,
        parent: { to: matched.to, label: matched.label },
        current: 'Record Detail',
      };
    }
    return {
      section: matched.section,
      parent: null,
      current: matched.label,
    };
  }, [isAdmin, location.pathname]);

  const handleSignOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const handleManualSync = () => {
    emitManualRefresh();
    setLastSyncTime(getLastSyncTimestamp());
  };

  const syncClockLabel = useMemo(() => {
    const parsed = new Date(lastSyncTime);
    if (Number.isNaN(parsed.getTime())) return 'Live';
    return parsed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }, [lastSyncTime]);

  const userInitials = useMemo(() => {
    const base = user?.name || user?.email || 'BL';
    return base.slice(0, 2).toUpperCase();
  }, [user]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const renderSection = (title: string, items: NavItem[]) => {
    const visible = items.filter((item) => !item.adminOnly || isAdmin);
    if (visible.length === 0) return null;
    return (
      <div className="sidebar-section">
        <span className="eyebrow-cap" style={{ paddingLeft: 12 }}>
          {title}
        </span>
        <nav className="sidebar-nav-list" aria-label={title}>
          {visible.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`.trim()
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    );
  };

  return (
    <div className="app-shell">
      {sidebarOpen ? (
        <div
          className="sidebar-backdrop"
          aria-hidden="true"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <aside className={`app-sidebar ${sidebarOpen ? 'app-sidebar-open' : ''}`.trim()}>
        <div className="app-sidebar-brand">
          <Link to="/dashboard" className="brand-mark" onClick={() => setSidebarOpen(false)}>
            <span className="brand-bolt">
              <Zap size={14} />
            </span>
            <span>Brightloop</span>
          </Link>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <StatusChip status={user?.role ?? 'staff'} showDot={false} />
            <button
              type="button"
              className="btn btn-secondary-sand mobile-only"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close navigation menu"
              style={{ padding: 5 }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, paddingBottom: 16, overflowY: 'auto' }}>
          {renderSection('Overview', OVERVIEW_NAV)}
          {renderSection('Sales & Subscriptions', SALES_NAV)}
          {renderSection('Catalog & Pricing', CATALOG_NAV)}
          {renderSection('Billing & Ledger', BILLING_NAV)}
          {isAdmin ? renderSection('Administration', ADMIN_NAV) : null}
        </div>

        <div className="sidebar-user-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <span className="avatar-circle">{userInitials}</span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--color-ink)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {user?.name || user?.email}
              </div>
              <div
                className="type-caption"
                style={{
                  fontSize: 11,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {user?.email}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => void handleSignOut()}
            title="Sign out"
            aria-label="Sign out"
            style={{ padding: 6 }}
          >
            <LogOut size={14} />
          </button>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <button
              type="button"
              className="btn btn-outline mobile-only"
              onClick={() => setSidebarOpen((o) => !o)}
              aria-label="Toggle navigation menu"
            >
              <Menu size={16} />
            </button>

            <nav className="breadcrumb-trail" aria-label="Breadcrumb">
              <span className="desktop-only">{breadcrumbs.section}</span>
              <ChevronRight size={13} className="desktop-only" />
              {breadcrumbs.parent ? (
                <>
                  <Link to={breadcrumbs.parent.to} className="breadcrumb-link">
                    {breadcrumbs.parent.label}
                  </Link>
                  <ChevronRight size={13} />
                </>
              ) : null}
              <span className="breadcrumb-current">{breadcrumbs.current}</span>
            </nav>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
            {/* Quick-Jump Search Bar (Ctrl+K) */}
            <button
              type="button"
              className="cmdk-trigger"
              onClick={() => setPaletteOpen(true)}
              aria-label="Open quick navigation search"
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <Search size={14} />
                <span className="desktop-only">Search…</span>
              </span>
              <span className="kbd-chip desktop-only">Ctrl K</span>
            </button>

            {/* Quick Action Menu */}
            <div style={{ position: 'relative' }}>
              <Button
                variant="primary"
                onClick={() => {
                  setNotifOpen(false);
                  setQuickCreateOpen((o) => !o);
                }}
                aria-label="Quick actions"
              >
                <Plus size={14} />
                <span className="desktop-only">New</span>
              </Button>

              {quickCreateOpen ? (
                <div
                  className="product-tile-compact"
                  style={{
                    position: 'absolute',
                    top: 44,
                    right: 0,
                    width: 230,
                    boxShadow: 'var(--shadow-modal)',
                    zIndex: 48,
                    padding: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <span className="eyebrow-cap" style={{ padding: '4px 10px' }}>
                    Quick Create
                  </span>
                  {[
                    { label: 'New Subscription', to: '/subscriptions' },
                    { label: 'Use Template', to: '/quotation-templates' },
                    { label: 'New Customer', to: '/customers' },
                    { label: 'Record Payment', to: '/payments' },
                    { label: 'Overdue Dunning', to: '/overdue' },
                    ...(isAdmin
                      ? [
                          { label: 'Products & Variants', to: '/products' },
                          { label: 'Plans & Discounts', to: '/plans' },
                        ]
                      : []),
                  ].map((act) => (
                    <button
                      key={act.to}
                      type="button"
                      className="cmdk-item"
                      onClick={() => {
                        setQuickCreateOpen(false);
                        navigate(act.to);
                      }}
                    >
                      <span>{act.label}</span>
                      <ChevronRight size={13} style={{ color: 'var(--color-ink-mute-2)' }} />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className="btn btn-outline"
              onClick={handleManualSync}
              title={`Synced ${syncClockLabel} — click to refresh`}
              aria-label="Sync live data"
              style={{ padding: '7px 9px' }}
            >
              <RefreshCw size={14} />
            </button>

            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setQuickCreateOpen(false);
                setNotifOpen((o) => !o);
              }}
              aria-label="Notifications"
              style={{ padding: unreadCount > 0 ? '7px 10px' : '7px 9px' }}
            >
              <Bell size={15} />
              {unreadCount > 0 ? <span style={{ fontSize: 12 }}>{unreadCount}</span> : null}
            </button>

            {notifOpen ? (
              <div
                className="product-tile-compact"
                style={{
                  position: 'absolute',
                  top: 46,
                  right: 0,
                  width: 'min(330px, calc(100vw - 32px))',
                  boxShadow: 'var(--shadow-modal)',
                  zIndex: 45,
                  padding: 16,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span className="eyebrow-cap">Notifications</span>
                  <button
                    type="button"
                    onClick={() =>
                      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
                    }
                    style={{
                      background: 'none',
                      border: 'none',
                      fontSize: 12,
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    Mark all read
                  </button>
                </div>
                {notifications.length === 0 ? (
                  <p className="type-caption">No recent notifications.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {notifications.slice(0, 5).map((n) => (
                      <div
                        key={n.id}
                        style={{
                          paddingBottom: 8,
                          borderBottom: '1px solid var(--color-hairline)',
                        }}
                      >
                        <div style={{ fontSize: 13 }}>{n.title}</div>
                        <div className="type-caption" style={{ fontSize: 12 }}>
                          {n.message}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </header>

        <main className="app-content">
          <Outlet />
        </main>
      </div>

      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        isAdmin={isAdmin}
      />
    </div>
  );
};
