import React from 'react';

export type ChipVariant =
  | 'draft'
  | 'quotation'
  | 'confirmed'
  | 'active'
  | 'paid'
  | 'paused'
  | 'closed'
  | 'cancelled'
  | 'overdue'
  | 'yellow'
  | 'neutral';

interface StatusChipProps {
  status: string;
  variant?: ChipVariant;
  showDot?: boolean;
}

const STATUS_TO_VARIANT: Record<string, ChipVariant> = {
  draft: 'draft',
  quotation: 'quotation',
  confirmed: 'confirmed',
  active: 'active',
  paid: 'paid',
  paused: 'paused',
  closed: 'closed',
  cancelled: 'cancelled',
  overdue: 'overdue',
  inactive: 'draft',
  admin: 'yellow',
  staff: 'confirmed',
  customer: 'neutral',
  inclusive: 'active',
  exclusive: 'neutral',
  reversal: 'cancelled',
};

function formatStatusLabel(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export const StatusChip: React.FC<StatusChipProps> = ({ status, variant, showDot = true }) => {
  const key = status.toLowerCase();
  const resolved = variant ?? STATUS_TO_VARIANT[key] ?? 'neutral';

  return (
    <span className={`status-chip chip-${resolved}`}>
      {showDot ? <span className="status-chip-dot" aria-hidden="true" /> : null}
      <span>{formatStatusLabel(status)}</span>
    </span>
  );
};

