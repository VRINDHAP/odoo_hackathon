import React from 'react';
import { Zap } from 'lucide-react';

export const AuthEditorialPanel: React.FC = () => (
  <aside className="auth-editorial-column">
    <div>
      <div className="brand-mark">
        <span className="brand-bolt">
          <Zap size={14} />
        </span>
        <span>Brightloop</span>
      </div>
    </div>

    <div style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <span className="eyebrow-cap">Recurring Finance Automation</span>
      <h1 className="type-display-lg">
        Catalog to cash settlement,{' '}
        <span className="highlight-name-overlay">without</span> operational noise.
      </h1>
      <p className="type-body-md" style={{ color: 'var(--color-ink-mute)' }}>
        Run quotations, multi-term subscriptions, GST-compliant invoicing, dunning reminders,
        and audit-grade ledger reporting from one unified workspace.
      </p>

      {/* Ramp Product-Tile Mosaic Preview */}
      <div className="tile-mosaic-2x2" style={{ marginTop: 8 }}>
        <div className="product-tile-compact atmosphere-midnight" style={{ borderColor: '#1f2937' }}>
          <span className="eyebrow-cap" style={{ color: '#94a3b8' }}>
            Lifecycle Engine
          </span>
          <div className="type-heading" style={{ color: '#ffffff', marginTop: 6 }}>
            Draft → Active
          </div>
          <p className="type-caption" style={{ color: '#cbd5e1', marginTop: 6 }}>
            Deterministic transitions gated by plan flags &amp; anchor days.
          </p>
        </div>

        <div className="product-tile-compact">
          <span className="eyebrow-cap">Precision Ledger</span>
          <div className="type-heading" style={{ marginTop: 6 }}>
            NUMERIC(14,2)
          </div>
          <p className="type-caption" style={{ marginTop: 6 }}>
            Exact 2-decimal rounding, inclusive/exclusive GST &amp; idempotent payments.
          </p>
        </div>
      </div>
    </div>

    <div className="type-caption" style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span>3-Layer RBAC · PostgreSQL Relational Core</span>
      <span>Brightloop v1.0</span>
    </div>
  </aside>
);

