/* ==========================================================================
   Date & Timezone Display Utilities (SPEC.md §5.9, §16)
   ========================================================================== */

import type { Invoice } from '../types/domain';

export function formatDate(isoOrDate: string | null | undefined): string {
  if (!isoOrDate) return '—';
  const date = new Date(isoOrDate);
  if (Number.isNaN(date.getTime())) return isoOrDate;
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * SPEC.md §5.9: Overdue badge displayed whenever:
 * status == 'confirmed' AND balance > 0 AND due_date < today
 */
export function isInvoiceOverdue(invoice: Pick<Invoice, 'status' | 'balance' | 'due_date'>, referenceDate?: string): boolean {
  const today = referenceDate ?? todayIsoDate();
  const balance = Number.parseFloat(invoice.balance);
  return invoice.status === 'confirmed' && balance > 0 && invoice.due_date < today;
}

export function daysOverdue(dueDate: string, referenceDate?: string): number {
  const today = new Date(`${referenceDate ?? todayIsoDate()}T00:00:00Z`);
  const due = new Date(`${dueDate}T00:00:00Z`);
  const diffMs = today.getTime() - due.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

