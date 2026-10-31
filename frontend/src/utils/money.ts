/* ==========================================================================
   Financial Formatting & Display Helpers (SPEC.md §5, §7.1, §10)
   - NUMERIC(14,2) fixed-precision string formatting with currency code
   - Half-up 2-decimal rounding for live Draft preview lines
   - MRR/ARR normalization display helper
   ========================================================================== */

import type { BillingPeriod } from '../types/domain';

export function roundHalfUp(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  return (sign * Math.floor(abs * 100 + 0.5 + 1e-9)) / 100;
}

export function toFixedMoney(value: number | string): string {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(parsed)) {
    return '0.00';
  }
  return roundHalfUp(parsed).toFixed(2);
}

export function parseMoney(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0;
  const num = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isNaN(num) ? 0 : num;
}

export function formatMoney(amount: string | number, currency = 'INR'): string {
  const num = parseMoney(amount);
  const abs = Math.abs(roundHalfUp(num));
  const formatted = abs.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return num < 0 ? `-${currency} ${formatted}` : `${currency} ${formatted}`;
}

export function normalizeToMonthlyMrr(totalAmount: string | number, period: BillingPeriod): number {
  const amount = parseMoney(totalAmount);
  switch (period) {
    case 'monthly':
      return roundHalfUp(amount);
    case 'yearly':
      return roundHalfUp(amount / 12);
    case 'weekly':
      return roundHalfUp((amount * 52) / 12);
    case 'daily':
      return roundHalfUp((amount * 365) / 12);
  }
}

