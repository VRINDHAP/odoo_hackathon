import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Boxes,
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
  Repeat,
  Settings,
  Shield,
  Users,
  Zap,
} from 'lucide-react';
import { apiRequest, getApiDataSourceMode } from '../api/client';
import { StatusChip } from '../components/chips/StatusChip';
import { Button } from '../components/forms/Primitives';
import { useAuth } from '../hooks/useAuth';
import type { NotificationItem } from '../types/domain';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

const OVERVIEW_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Finance Dashboard', icon: <LayoutDashboard size={16} /> },
];

const SALES_NAV: NavItem[] = [
  { to: '/customers', label: 'Customers', icon: <Users size={16} /> },
  { to: '/quotation-templates', label: 'Quotation Templates', icon: <FileSpreadsheet size={16} /> },
  { to: '/subscriptions', label: 'Subscriptions', icon: <Repeat size={16} /> },
];

const CATALOG_NAV: NavItem[] = [
  { to: '/products', label: 'Products & Variants', icon: <Boxes size={16} /> },
  { to: '/plans', label: 'Plans & Flags', icon: <Layers size={16} /> },
  { to: '/taxes', label: 'Tax Rules', icon: <Receipt size={16} /> },
  { to: '/discounts', label: 'Discounts', icon: <Percent size={16} />, adminOnly: true },
];

const BILLING_NAV: NavItem[] = [
  { to: '/invoices', label: 'Invoices', icon: <FileText size={16} /> },
  { to: '/payments', label: 'Payments Register', icon: <CreditCard size={16} /> },
  { to: '/overdue', label: 'Overdue & Aging', icon: <AlertTriangle size={16} /> },
  { to: '/reports', label: 'Reports & CSV', icon: <BarChart3 size={16} /> },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/staff', label: 'Staff Directory', icon: <Shield size={16} />, adminOnly: true },
  { to: '/audit-logs', label: 'Audit Log', icon: <History size={16} />, adminOnly: true },
  { to: '/settings', label: 'System Settings', icon: <Settings size={16} />, adminOnly: true },
];

export const WorkspaceLayout: React.FC = () => {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  useEffect(() => {
    apiRequest<NotificationItem[]>('/notifications')
      .then(setNotifications)
      .catch(() => undefined);
  }, []);

  const handleSignOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

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
      <aside className={`app-sidebar ${sidebarOpen ? 'app-sidebar-open' : ''}`.trim()}>
        <div className="app-sidebar-brand">
          <div className="brand-mark">
            <span className="brand-bolt">
              <Zap size={14} />
            </span>
            <span>Brightloop</span>
          </div>
          <StatusChip status={user?.role ?? 'staff'} showDot={false} />
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              className="btn btn-outline mobile-only"
              onClick={() => setSidebarOpen((o) => !o)}
              aria-label="Toggle navigation menu"
            >
              <Menu size={16} />
            </button>
            <span className="type-caption">
              {isAdmin ? 'Executive & Admin Console' : 'Internal Staff Operations'}
            </span>
            <StatusChip
              status={getApiDataSourceMode() === 'live' ? 'Live API' : 'Sandbox Ledger'}
              variant={getApiDataSourceMode() === 'live' ? 'active' : 'neutral'}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
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
                  right: 110,
                  width: 340,
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

            <span className="type-caption" style={{ color: 'var(--color-ink)' }}>
              {user?.email}
            </span>

            <Button variant="outline" onClick={() => void handleSignOut()}>
              <LogOut size={14} />
              Sign out
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

