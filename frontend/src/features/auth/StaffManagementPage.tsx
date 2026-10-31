import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { apiRequest, ApiClientError } from '../../api/client';
import { StatusChip } from '../../components/chips/StatusChip';
import {
  Button,
  ConfirmModal,
  FormInput,
  FormSelect,
  Modal,
  PasswordChecklist,
} from '../../components/forms/Primitives';
import { DataTable, type DataColumn } from '../../components/tables/DataTable';
import { useAuth } from '../../hooks/useAuth';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../hooks/useToast';
import type { AuthUser, UserRole } from '../../types/domain';
import { formatDateTime } from '../../utils/dates';
import { evaluatePasswordStrength, isValidEmail, normalizeEmail } from '../../utils/validation';

/**
 * FE-1.6: Staff Management & Provisioning Modal (Admin Only) [SPEC.md §2, §5.1, §12.2]
 */
export const StaffManagementPage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const { showToast } = useToast();

  const [staffList, setStaffList] = useState<AuthUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  // Create Staff Modal
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('BrightStaff#2026');
  const [inviteRole, setInviteRole] = useState<UserRole>('staff');
  const [inviteErrors, setInviteErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Destructive Confirmation Modal (SPEC.md §12.4: demote / deactivate requires modal confirmation)
  const [confirmAction, setConfirmAction] = useState<{
    target: AuthUser;
    kind: 'demote' | 'toggle_active';
  } | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  const loadStaff = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiRequest<AuthUser[]>('/users/staff');
      setStaffList(data);
    } catch {
      showToast('Failed to load staff directory', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  const filteredRows = staffList.filter((s) => {
    if (!debouncedSearch) return true;
    const q = debouncedSearch.toLowerCase();
    return (
      s.email.toLowerCase().includes(q) ||
      (s.name ?? '').toLowerCase().includes(q) ||
      s.role.toLowerCase().includes(q)
    );
  });

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!inviteName.trim()) errs.name = 'Staff member name is required.';
    if (!isValidEmail(inviteEmail)) errs.email = 'Valid work email is required.';
    if (!evaluatePasswordStrength(invitePassword).isValid) {
      errs.password =
        'Initial password must be 9+ characters with uppercase, lowercase, and special character.';
    }
    if (Object.keys(errs).length > 0) {
      setInviteErrors(errs);
      return;
    }

    setInviteErrors({});
    setIsSubmitting(true);
    try {
      const created = await apiRequest<AuthUser>('/users/staff', {
        method: 'POST',
        body: {
          name: inviteName.trim(),
          email: normalizeEmail(inviteEmail),
          password: invitePassword,
          role: inviteRole,
        },
      });
      setStaffList((prev) => [created, ...prev]);
      showToast(`Provisioned ${created.role} account for ${created.email}`, 'success');
      setIsInviteOpen(false);
      setInviteName('');
      setInviteEmail('');
      setInvitePassword('BrightStaff#2026');
      setInviteRole('staff');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setInviteErrors(err.toFieldMap());
        showToast(err.message, 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmMutation = async () => {
    if (!confirmAction) return;
    setIsMutating(true);
    try {
      const { target, kind } = confirmAction;
      const body =
        kind === 'demote'
          ? { role: 'staff' }
          : { is_active: !(target.is_active ?? true) };
      const updated = await apiRequest<AuthUser>(`/users/staff/${target.id}`, {
        method: 'PATCH',
        body,
      });
      setStaffList((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      showToast(`Updated account permissions for ${updated.email}`, 'success');
      setConfirmAction(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'error');
    } finally {
      setIsMutating(false);
    }
  };

  const columns: DataColumn<AuthUser>[] = [
    {
      key: 'identity',
      header: 'Member & Email',
      sortValue: (u) => u.email,
      render: (u) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>{u.name ?? u.email.split('@')[0]}</span>
          <span className="type-caption">{u.email}</span>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      sortValue: (u) => u.role,
      render: (u) => <StatusChip status={u.role} />,
    },
    {
      key: 'status',
      header: 'Account Status',
      render: (u) =>
        u.locked_until ? (
          <StatusChip status="Locked" variant="cancelled" />
        ) : (u.is_active ?? true) ? (
          <StatusChip status="Active" variant="active" />
        ) : (
          <StatusChip status="Inactive" variant="draft" />
        ),
    },
    {
      key: 'failed',
      header: 'Failed Logins',
      align: 'right',
      sortValue: (u) => u.failed_attempts ?? 0,
      render: (u) => <span className="mono-text">{u.failed_attempts ?? 0}</span>,
    },
    {
      key: 'last_login',
      header: 'Last Sign-In',
      render: (u) => <span className="type-caption">{formatDateTime(u.last_login_at)}</span>,
    },
    {
      key: 'actions',
      header: 'Controls',
      align: 'right',
      render: (u) => {
        const isSelf = u.id === currentUser?.id;
        return (
          <div style={{ display: 'inline-flex', gap: 6 }}>
            {u.role === 'admin' && !isSelf ? (
              <Button
                variant="outline"
                onClick={() => setConfirmAction({ target: u, kind: 'demote' })}
              >
                Demote to Staff
              </Button>
            ) : null}
            {!isSelf ? (
              <Button
                variant={u.is_active ?? true ? 'danger' : 'outline'}
                onClick={() => setConfirmAction({ target: u, kind: 'toggle_active' })}
              >
                {u.is_active ?? true ? 'Deactivate' : 'Reactivate'}
              </Button>
            ) : (
              <span className="type-caption">Current Session</span>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">Access Control · Admin Only</span>
          <h1 className="type-display-md">Internal Staff Directory</h1>
          <p className="type-caption">
            Provision internal operational accounts and monitor authentication security counters.
          </p>
        </div>
        <div className="page-header-actions">
          <Button variant="primary" onClick={() => setIsInviteOpen(true)}>
            <UserPlus size={15} />
            Invite Staff
          </Button>
        </div>
      </header>

      <DataTable
        columns={columns}
        rows={filteredRows}
        rowKey={(u) => u.id}
        isLoading={isLoading}
        toolbar={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 12, flexWrap: 'wrap' }}>
            <input
              type="search"
              className="form-input"
              placeholder="Search staff by name, email, or role…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ maxWidth: 340 }}
            />
            <span className="type-caption">{filteredRows.length} internal accounts</span>
          </div>
        }
        emptyTitle="No matching staff accounts"
        emptyDescription="Provision a new internal Staff account to delegate daily billing operations."
      />

      <Modal
        isOpen={isInviteOpen}
        title="Provision Internal Staff Account"
        eyebrow="POST /api/v1/users/staff"
        onClose={() => setIsInviteOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setIsInviteOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreateStaff} isLoading={isSubmitting}>
              Create Staff Account
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateStaff} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormInput
            label="Full Name"
            placeholder="Sooraj P"
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
            error={inviteErrors.name}
          />
          <FormInput
            label="Work Email"
            type="email"
            placeholder="sooraj@ssvnsystems.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            error={inviteErrors.email}
            helperText="Email is normalized to lowercase and verified for uniqueness."
          />
          <FormInput
            label="Initial Password"
            type="password"
            value={invitePassword}
            onChange={(e) => setInvitePassword(e.target.value)}
            error={inviteErrors.password}
          />
          <PasswordChecklist password={invitePassword} />
          <FormSelect
            label="Assigned RBAC Role"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as UserRole)}
            options={[
              { value: 'staff', label: 'Internal Staff — Operational Read/Write (No Catalog/Delete)' },
              { value: 'admin', label: 'Administrator — Full System & Financial Access' },
            ]}
          />
        </form>
      </Modal>

      <ConfirmModal
        isOpen={Boolean(confirmAction)}
        title={
          confirmAction?.kind === 'demote'
            ? 'Demote Administrator?'
            : confirmAction?.target.is_active ?? true
              ? 'Deactivate Staff Account?'
              : 'Reactivate Staff Account?'
        }
        description={
          confirmAction?.kind === 'demote'
            ? `${confirmAction.target.email} will lose access to Catalog writes, Discounts, Audit Logs, and Staff provisioning.`
            : `Are you sure you want to change sign-in access for ${confirmAction?.target.email ?? ''}?`
        }
        confirmLabel="Confirm Change"
        destructive={confirmAction?.kind === 'demote' || (confirmAction?.target.is_active ?? true)}
        isLoading={isMutating}
        onConfirm={() => void handleConfirmMutation()}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
};

