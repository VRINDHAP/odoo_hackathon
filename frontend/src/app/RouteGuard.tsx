import React, { useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import type { UserRole } from '../types/domain';

interface RouteGuardProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}

/**
 * SPEC.md §2 & DONE.md §1:
 * Layer 1 RBAC Route Guard — restricts unauthorized URL navigation and redirects with notice.
 */
export const RouteGuard: React.FC<RouteGuardProps> = ({ allowedRoles, children }) => {
  const { user, isHydrating, isAuthenticated } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const notifiedPathRef = useRef<string | null>(null);

  const isForbidden = Boolean(user && !allowedRoles.includes(user.role));

  useEffect(() => {
    if (isForbidden && notifiedPathRef.current !== location.pathname) {
      notifiedPathRef.current = location.pathname;
      showToast(
        `Access restricted: your "${user?.role}" role cannot open ${location.pathname}.`,
        'error'
      );
    }
  }, [isForbidden, location.pathname, showToast, user?.role]);

  if (isHydrating) {
    return (
      <div style={{ padding: 48, maxWidth: 680, margin: '0 auto' }}>
        <div className="product-tile">
          <div className="skeleton-line" style={{ width: '35%', marginBottom: 14 }} />
          <div className="skeleton-line" style={{ width: '80%' }} />
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (!allowedRoles.includes(user.role)) {
    const fallback = user.role === 'customer' ? '/portal/subscriptions' : '/dashboard';
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
};

