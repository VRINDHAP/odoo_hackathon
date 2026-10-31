import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  CreditCard,
  FileText,
  Layers,
  LogOut,
  Menu,
  RefreshCw,
  UserCircle2,
  X,
  Zap,
} from 'lucide-react';
import { getApiDataSourceMode } from '../api/client';
import { emitManualRefresh } from '../api/realtimeBus';
import { StatusChip } from '../components/chips/StatusChip';
import { Button } from '../components/forms/Primitives';
import { useAuth } from '../hooks/useAuth';

/**
 * SPEC.md §9 & §12.3:
 * Customer Portal Shell — strictly isolated to /portal/* routes consuming /me/* endpoints.
 */
export const PortalLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const links = [
    { to: '/portal/subscriptions', label: 'My Subscriptions', icon: Layers },
    { to: '/portal/invoices', label: 'My Invoices', icon: FileText },
    { to: '/portal/payments', label: 'Payment History', icon: CreditCard },
    { to: '/portal/profile', label: 'Profile & Password', icon: UserCircle2 },
  ];

  const userInitials = (user?.name ?? user?.email ?? 'CU')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="portal-shell">
      <header className="portal-navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="btn btn-outline mobile-only"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label="Toggle portal navigation"
              style={{ padding: 6 }}
            >
              {mobileMenuOpen ? <X size={16} /> : <Menu size={16} />}
            </button>
            <div className="brand-mark">
              <span className="brand-bolt">
                <Zap size={14} />
              </span>
              <span>Brightloop Portal</span>
            </div>
          </div>

          <nav
            className="portal-nav-links desktop-only"
            aria-label="Customer Portal Navigation"
          >
            {links.map((link) => {
              const Icon = link.icon;
              return (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) =>
                    `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`.trim()
                  }
                >
                  <Icon size={15} />
                  <span>{link.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => emitManualRefresh()}
            title="Sync live portal account data"
            aria-label="Sync portal data"
            style={{ padding: '7px 10px' }}
          >
            <RefreshCw size={14} />
          </button>
          <span className="desktop-only">
            <StatusChip
              status={getApiDataSourceMode() === 'live' ? 'Live Portal' : 'Customer Portal'}
              variant={getApiDataSourceMode() === 'live' ? 'active' : 'neutral'}
            />
          </span>
          <div
            className="desktop-only"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 4px' }}
          >
            <span className="avatar-circle" style={{ width: 26, height: 26, fontSize: 11 }}>
              {userInitials || 'CU'}
            </span>
            <span className="type-caption" style={{ color: 'var(--color-ink)' }}>
              {user?.email}
            </span>
          </div>
          <Button variant="outline" onClick={() => void handleLogout()}>
            <LogOut size={14} />
            <span className="desktop-only">Sign out</span>
          </Button>
        </div>

        {mobileMenuOpen ? (
          <nav
            className="mobile-only"
            aria-label="Mobile Customer Portal Navigation"
            style={{
              width: '100%',
              flexDirection: 'column',
              gap: 4,
              paddingTop: 8,
              borderTop: '1px solid var(--color-hairline)',
            }}
          >
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`.trim()
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
      </header>

      <main className="portal-content">
        <Outlet />
      </main>
    </div>
  );
};
