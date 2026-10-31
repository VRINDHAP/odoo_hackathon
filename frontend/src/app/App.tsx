import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { ToastProvider } from '../hooks/useToast';
import { ModuleStageCard } from './ModuleStageCard';
import { PortalLayout } from './PortalLayout';
import { RouteGuard } from './RouteGuard';
import { WorkspaceLayout } from './WorkspaceLayout';

// Route-level code splitting (SPEC.md §11)
const LoginPage = lazy(() =>
  import('../features/auth/LoginPage').then((m) => ({ default: m.LoginPage }))
);
const SignupPage = lazy(() =>
  import('../features/auth/SignupPage').then((m) => ({ default: m.SignupPage }))
);
const ForgotPasswordPage = lazy(() =>
  import('../features/auth/ForgotResetPasswordPage').then((m) => ({
    default: m.ForgotPasswordPage,
  }))
);
const ResetPasswordPage = lazy(() =>
  import('../features/auth/ForgotResetPasswordPage').then((m) => ({
    default: m.ResetPasswordPage,
  }))
);
const StaffManagementPage = lazy(() =>
  import('../features/auth/StaffManagementPage').then((m) => ({
    default: m.StaffManagementPage,
  }))
);
const AuditLogPage = lazy(() =>
  import('../features/audit/AuditLogPage').then((m) => ({ default: m.AuditLogPage }))
);
const SettingsPage = lazy(() =>
  import('../features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);
const ProductsPage = lazy(() =>
  import('../features/catalog/ProductsPage').then((m) => ({ default: m.ProductsPage }))
);
const PlansPage = lazy(() =>
  import('../features/plans/PlansPage').then((m) => ({ default: m.PlansPage }))
);
const TaxesPage = lazy(() =>
  import('../features/taxes/TaxesPage').then((m) => ({ default: m.TaxesPage }))
);
const CustomersPage = lazy(() =>
  import('../features/customers/CustomersPage').then((m) => ({ default: m.CustomersPage }))
);
const CustomerDetailPage = lazy(() =>
  import('../features/customers/CustomerDetailPage').then((m) => ({
    default: m.CustomerDetailPage,
  }))
);
const QuotationTemplatesPage = lazy(() =>
  import('../features/templates/QuotationTemplatesPage').then((m) => ({
    default: m.QuotationTemplatesPage,
  }))
);
const SubscriptionsPage = lazy(() =>
  import('../features/subscriptions/SubscriptionsPage').then((m) => ({
    default: m.SubscriptionsPage,
  }))
);
const SubscriptionDetailPage = lazy(() =>
  import('../features/subscriptions/SubscriptionDetailPage').then((m) => ({
    default: m.SubscriptionDetailPage,
  }))
);
const DiscountsPage = lazy(() =>
  import('../features/discounts/DiscountsPage').then((m) => ({ default: m.DiscountsPage }))
);
const InvoicesPage = lazy(() =>
  import('../features/invoices/InvoicesPage').then((m) => ({ default: m.InvoicesPage }))
);
const InvoiceDetailPage = lazy(() =>
  import('../features/invoices/InvoiceDetailPage').then((m) => ({
    default: m.InvoiceDetailPage,
  }))
);
const PaymentsPage = lazy(() =>
  import('../features/payments/PaymentsPage').then((m) => ({
    default: m.PaymentsPage,
  }))
);
const OverdueAgingPage = lazy(() =>
  import('../features/payments/OverdueAgingPage').then((m) => ({
    default: m.OverdueAgingPage,
  }))
);

const RootRedirect: React.FC = () => {
  const { user, isHydrating } = useAuth();
  if (isHydrating) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'customer' ? '/portal/subscriptions' : '/dashboard'} replace />;
};

const PageLoader: React.FC = () => (
  <div style={{ padding: 28 }}>
    <div className="product-tile">
      <div className="skeleton-line" style={{ width: '32%', marginBottom: 12 }} />
      <div className="skeleton-line" style={{ width: '68%' }} />
    </div>
  </div>
);

export const AppRoutes: React.FC = () => (
  <Suspense fallback={<PageLoader />}>
    <Routes>
      {/* Public Auth Routes */}
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Admin & Internal Staff Application */}
      <Route
        element={
          <RouteGuard allowedRoles={['admin', 'staff']}>
            <WorkspaceLayout />
          </RouteGuard>
        }
      >
        <Route
          path="/dashboard"
          element={
            <ModuleStageCard
              partNumber={6}
              eyebrow="Executive Finance View"
              title="Revenue & Subscription Dashboard"
              summary="KPI mosaic (MRR, ARR, Active Subs, Overdue), revenue trend lines, and aging buckets."
            />
          }
        />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/taxes" element={<TaxesPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
        <Route path="/quotation-templates" element={<QuotationTemplatesPage />} />
        <Route path="/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/subscriptions/:id" element={<SubscriptionDetailPage />} />
        <Route
          path="/discounts"
          element={
            <RouteGuard allowedRoles={['admin']}>
              <DiscountsPage />
            </RouteGuard>
          }
        />
        <Route path="/invoices" element={<InvoicesPage />} />
        <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="/payments" element={<PaymentsPage />} />
        <Route path="/overdue" element={<OverdueAgingPage />} />
        <Route
          path="/reports"
          element={
            <ModuleStageCard
              partNumber={6}
              eyebrow="Financial Intelligence"
              title="Reports & CSV Exports"
              summary="Active subscriptions, monthly revenue by plan/product, and downloadable CSV streams."
            />
          }
        />

        {/* Phase 1 Completed Admin Modules */}
        <Route
          path="/staff"
          element={
            <RouteGuard allowedRoles={['admin']}>
              <StaffManagementPage />
            </RouteGuard>
          }
        />
        <Route
          path="/audit-logs"
          element={
            <RouteGuard allowedRoles={['admin']}>
              <AuditLogPage />
            </RouteGuard>
          }
        />
        <Route
          path="/settings"
          element={
            <RouteGuard allowedRoles={['admin']}>
              <SettingsPage />
            </RouteGuard>
          }
        />
      </Route>

      {/* Customer Self-Service Portal (/portal/* -> /me/*) */}
      <Route
        path="/portal"
        element={
          <RouteGuard allowedRoles={['customer']}>
            <PortalLayout />
          </RouteGuard>
        }
      >
        <Route index element={<Navigate to="/portal/subscriptions" replace />} />
        <Route
          path="subscriptions"
          element={
            <ModuleStageCard
              partNumber={7}
              eyebrow="Customer Portal"
              title="My Subscriptions"
              summary="View your active plan, upcoming renewal date, and request upgrades or pauses."
            />
          }
        />
        <Route
          path="invoices"
          element={
            <ModuleStageCard
              partNumber={7}
              eyebrow="Customer Portal"
              title="My Invoices"
              summary="Download tax invoice PDFs and settle balances via online sandbox checkout."
            />
          }
        />
        <Route
          path="payments"
          element={
            <ModuleStageCard
              partNumber={7}
              eyebrow="Customer Portal"
              title="Payment History"
              summary="Browse completed payment receipts and settlement references."
            />
          }
        />
        <Route
          path="profile"
          element={
            <ModuleStageCard
              partNumber={7}
              eyebrow="Customer Portal"
              title="Profile & Billing Address"
              summary="Update your organization billing address and portal account password."
            />
          }
        />
      </Route>

      <Route path="*" element={<RootRedirect />} />
    </Routes>
  </Suspense>
);

export const App: React.FC = () => (
  <BrowserRouter>
    <ToastProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ToastProvider>
  </BrowserRouter>
);

