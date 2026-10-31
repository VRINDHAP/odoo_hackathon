import React from 'react';
import { Link } from 'react-router-dom';
import { StatusChip } from '../components/chips/StatusChip';
import { useAuth } from '../hooks/useAuth';

interface ModuleStageCardProps {
  partNumber: number;
  eyebrow: string;
  title: string;
  summary: string;
}

/**
 * Clean Ramp-styled placeholder card for routes scheduled in upcoming Parts 2–7
 * so every navigation item in Phase 1 renders cleanly without 404s.
 */
export const ModuleStageCard: React.FC<ModuleStageCardProps> = ({
  partNumber,
  eyebrow,
  title,
  summary,
}) => {
  const { isAdmin } = useAuth();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header className="page-header">
        <div className="page-header-titles">
          <span className="eyebrow-cap">{eyebrow}</span>
          <h1 className="type-display-md">{title}</h1>
          <p className="type-caption">{summary}</p>
        </div>
        <StatusChip status={`Scheduled · Part ${partNumber}`} variant="quotation" />
      </header>

      <div className="tile-mosaic-2x2">
        <div className="product-tile">
          <span className="eyebrow-cap">Part-by-Part Build Status</span>
          <h2 className="type-heading" style={{ marginTop: 6, marginBottom: 8 }}>
            Foundation &amp; RBAC Active (Part 1 Complete)
          </h2>
          <p className="type-caption" style={{ marginBottom: 16 }}>
            Route guards, JWT silent refresh, Ramp design tokens, and the relational mock ledger are live.
            This module&apos;s interactive views will be mounted in <strong>Part {partNumber}</strong>.
          </p>
          {isAdmin ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link to="/staff" className="btn btn-cta-chip">
                Inspect Staff Directory →
              </Link>
              <Link to="/audit-logs" className="btn btn-outline">
                Open Audit Log Diffs
              </Link>
              <Link to="/settings" className="btn btn-outline">
                System Settings
              </Link>
            </div>
          ) : null}
        </div>

        <div className="product-tile-dark">
          <span className="eyebrow-cap" style={{ color: '#94a3b8' }}>
            Ramp Editorial Architecture
          </span>
          <h2 className="type-heading" style={{ marginTop: 6, marginBottom: 8 }}>
            Single Weight 400 · Sand Canvas #f4f2f0
          </h2>
          <p className="type-caption" style={{ color: '#cbd5e1' }}>
            Every module uses 1px hairline bordered white tiles, compact 8px-radius status badges,
            and right-aligned NUMERIC(14,2) financial columns.
          </p>
        </div>
      </div>
    </div>
  );
};

