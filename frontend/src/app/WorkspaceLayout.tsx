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
  Receipt,
  RefreshCw,
  Repeat,
  Settings,
  Shield,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { apiRequest, getApiDataSourceMode } from '../api/client';
import { emitManualRefresh, getLastSyncTimestamp } from '../api/realtimeBus';
import { StatusChip } from '../components/chips/StatusChip';
import { Button } from '../components/forms/Primitives';
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
  { to: '/dashboard', label: 'Finance Dashboard', section: 'Overview', icon: <LayoutDashboard size={16} /> },
];

const SALES_NAV: NavItem[] = [
  { to: '/customers', label: 'Customers', section: 'Sales & Subscriptions', icon: <Users size={16} /> },
  { to: '/quotation-templates', label: 'Quotation Templates', section: 'Sales & Subscriptions', icon: <FileSpreadsheet size={16} /> },
  { to: '/subscriptions', label: 'Subscriptions', section: 'Sales & Subscriptions', icon: <Repeat size={16} /> },
];

const CATALOG_NAV: NavItem[] = [
  { to: '/products', label: 'Products & Variants', section: 'Catalog & Pricing', icon: <Boxes size={16} /> },
  { to: '/plans', label: 'Plans & Flags', section: 'Catalog & Pricing', icon: <Layers size={16} /> },
  { to: '/taxes', label: 'Tax Rules', section: 'Catalog & Pricing', icon: <Receipt size={16} /> },
  { to: '/discounts', label: 'Discounts', section: 'Catalog & Pricing', icon: <Percent size={16} />, adminOnly: true },
];

const BILLING_NAV: NavItem[] = [
  { to: '/invoices', label: 'Invoices', section: 'Billing & Ledger', icon: <FileText size={16} /> },
  { to: '/payments', label: 'Payments Register', section: 'Billing & Ledger', icon: <CreditCard size={16} /> },
  { to: '/overdue', label: 'Overdue & Aging', section: 'Billing & Ledger', icon: <AlertTriangle size={16} /> },
  { to: '/reports', label: 'Reports & CSV', section: 'Billing & Ledger', icon: <BarChart3 size={16} /> },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/staff', label: 'Staff Directory', section: 'Administration', icon: <Shield size={16} />, adminOnly: true },
  { to: '/audit-logs', label: 'Audit Log', section: 'Administration', icon: <History size={16} />, adminOnly: true },
  { to: '/settings', label: 'System Settings', section: 'Administration', icon: <Settings size={16} />, adminOnly: true },
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

  const breadcrumbs = useMemo(() => {
    const path = location.pathname;
    const matched = ALL_NAV_ITEMS.find(
      (item) => path === item.to || path.startsWith(`${item.to}/`)
    );
    if (!matched) {
      return {
        section: isAdmin ? 'Executive & Admin Console' : 'Internal Staff Operations',
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
          <div className="brand-mark">
            <span className="brand-bolt">
              <Zap size={14} />
            </span>
            <span>Brightloop</span>
          </div>
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

        <div style={{ flex: 1, paddingBottom: 20 }}>
          {renderSection('Overview', OVERVIEW_NAV)}
          {renderSection('Sales & Subscriptions', SALES_NAV)}
          {renderSection('Catalog & Pricing', CATALOG_NAV)}
          {renderSection('Billing & Ledger', BILLING_NAV)}
          {isAdmin ? renderSection('Administration', ADMIN_NAV) : null}
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

            <span className="desktop-only" style={{ marginLeft: 4 }}>
              <StatusChip
                status={
                  getApiDataSourceMode() === 'live'
                    ? `Live API · ${syncClockLabel}`
                    : `Dynamic Ledger · ${syncClockLabel}`
                }
                variant={getApiDataSourceMode() === 'live' ? 'active' : 'neutral'}
              />
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={handleManualSync}
              title="Sync live ledger data across tabs"
              aria-label="Sync live data"
              style={{ padding: '7px 10px' }}
            >
              <RefreshCw size={14} />
            </button>

            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setNotifOpen((o) => !o)}
              aria-label="Notifications"
            >
              <Bell size={15} />
              <span>{notifications.filter((n) => !n.read).length}</span>
            </button>

            {notifOpen ? (
              <div
                className="product-tile-compact"
                style={{
                  position: 'absolute',
                  top: 46,
                  right: 0,
                  width: 'min(340px, calc(100vw - 32px))',
                  boxShadow: 'var(--shadow-modal)',
                  zIndex: 45,
                  padding: 16,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span className="eyebrow-cap">System Alerts</span>
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

            <span className="type-caption desktop-only" style={{ color: 'var(--color-ink)' }}>
              {user?.email}
            </span>

            <Button variant="outline" onClick={() => void handleSignOut()}>
              <LogOut size={14} />
              <span className="desktop-only">Sign out</span>
            </Button>
          </div>
        </header>

        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
