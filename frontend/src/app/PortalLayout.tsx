import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LogOut, Zap } from 'lucide-react';
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

  const links = [
    { to: '/portal/subscriptions', label: 'My Subscriptions' },
    { to: '/portal/invoices', label: 'My Invoices' },
    { to: '/portal/payments', label: 'Payment History' },
    { to: '/portal/profile', label: 'Profile & Password' },
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="portal-shell">
      <header className="portal-navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div className="brand-mark">
            <span className="brand-bolt">
              <Zap size={14} />
            </span>
            <span>Brightloop Portal</span>
          </div>

          <nav className="portal-nav-links" aria-label="Customer Portal Navigation">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`.trim()
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <StatusChip status="Customer Portal" variant="neutral" />
          <span className="type-caption" style={{ color: 'var(--color-ink)' }}>
            {user?.email}
          </span>
          <Button variant="outline" onClick={() => void handleLogout()}>
            <LogOut size={14} />
            Sign out
          </Button>
        </div>
      </header>

      <main className="portal-content">
        <Outlet />
      </main>
    </div>
  );
};

