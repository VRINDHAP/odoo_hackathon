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

    <div style={{ maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <span className="eyebrow-cap">Subscription &amp; Revenue Operations</span>
      <h1 className="type-display-lg">
        Recurring billing, <span className="highlight-name-overlay">without</span> the noise.
      </h1>
      <p className="type-body-md" style={{ color: 'var(--color-ink-mute)' }}>
        Manage quotations, subscriptions, GST-compliant invoices, payments, and live revenue reporting in one calm workspace.
      </p>

      <div className="tile-mosaic-2x2" style={{ marginTop: 8 }}>
        <div className="product-tile-compact atmosphere-midnight" style={{ borderColor: '#1f2937' }}>
          <span className="eyebrow-cap" style={{ color: '#94a3b8' }}>
            Subscriptions
          </span>
          <div className="type-heading" style={{ color: '#ffffff', marginTop: 6 }}>
            Draft → Active
          </div>
          <p className="type-caption" style={{ color: '#cbd5e1', marginTop: 6 }}>
            Plan-driven pause, renewal, variant pricing, and self-service add-ons.
          </p>
        </div>

        <div className="product-tile-compact">
          <span className="eyebrow-cap">Billing &amp; Tax</span>
          <div className="type-heading" style={{ marginTop: 6 }}>
            Instant Ledger
          </div>
          <p className="type-caption" style={{ marginTop: 6 }}>
            Automated discounts, GST rules, PDF invoices, and online settlements.
          </p>
        </div>
      </div>
    </div>

    <div className="type-caption" style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span>Admin · Staff · Customer Portal</span>
      <span>Brightloop</span>
    </div>
  </aside>
);
