import React, { useState } from 'react';
import type { AgingBucketSummary, PaymentMethod } from '../../types/domain';
import { formatMoney, parseMoney } from '../../utils/money';

/* ==========================================================================
   FE-6.2: Interactive Financial Charts (Zero-Bloat Pure SVG + Ramp Geometry)
   - RevenueTrendChart: Dual-line SVG chart (Invoiced vs Collected) with hover crosshair
   - PaymentsByMethodChart: SVG Donut + horizontal method breakdown with hover inspect
   - AgingBucketsChart: Interactive 4-bucket dunning bar chart with hover tooltip
   ========================================================================== */

interface TrendPoint {
  month: string;
  invoiced: number;
  collected: number;
}

interface RevenueTrendChartProps {
  data: TrendPoint[];
  currency: string;
}

export const RevenueTrendChart: React.FC<RevenueTrendChartProps> = ({ data, currency }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="type-caption" style={{ padding: '32px 0', textAlign: 'center' }}>
        No monthly revenue trend points in selected range.
      </div>
    );
  }

  const width = 620;
  const height = 220;
  const padLeft = 56;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 34;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxVal = Math.max(
    1,
    ...data.map((d) => Math.max(d.invoiced, d.collected))
  ) * 1.12;

  const xAt = (idx: number) =>
    data.length === 1 ? padLeft + plotW / 2 : padLeft + (idx / (data.length - 1)) * plotW;
  const yAt = (val: number) => padTop + plotH - (val / maxVal) * plotH;

  const invoicedPath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(d.invoiced).toFixed(1)}`)
    .join(' ');

  const collectedPath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(d.collected).toFixed(1)}`)
    .join(' ');

  const invoicedArea = `${invoicedPath} L ${xAt(data.length - 1).toFixed(1)} ${(
    padTop + plotH
  ).toFixed(1)} L ${xAt(0).toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`;

  const activePoint = hoveredIdx !== null ? data[hoveredIdx] : null;
  const gridTicks = [0, 0.5, 1];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Legend & Live Hover Readout */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          minHeight: 28,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className="type-caption" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: 'var(--color-ink)',
              }}
            />
            Total Invoiced
          </span>
          <span className="type-caption" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: 'var(--color-accent-blaze)',
              }}
            />
            Cash Collected
          </span>
        </div>

        {activePoint ? (
          <div
            role="tooltip"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 12,
              padding: '4px 10px',
              borderRadius: 'var(--rounded-md)',
              backgroundColor: 'var(--color-canvas)',
              border: '1px solid var(--color-hairline-strong)',
              fontSize: 12,
            }}
          >
            <strong style={{ fontWeight: 400, color: 'var(--color-ink)' }}>{activePoint.month}</strong>
            <span className="cell-numeric">
              Invoiced: {formatMoney(activePoint.invoiced, currency)}
            </span>
            <span className="cell-numeric" style={{ color: 'var(--color-accent-blaze)' }}>
              Collected: {formatMoney(activePoint.collected, currency)}
            </span>
          </div>
        ) : (
          <span className="type-caption">Hover data points to inspect exact figures</span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', overflow: 'visible' }}
        role="img"
        aria-label="Monthly revenue trend chart"
      >
        <defs>
          <linearGradient id="rampInvoicedFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1c1b17" stopOpacity="0.09" />
            <stop offset="100%" stopColor="#1c1b17" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Horizontal Hairline Grid */}
        {gridTicks.map((t) => {
          const val = maxVal * t;
          const y = yAt(val);
          return (
            <g key={t}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="#e2e8f0"
                strokeDasharray={t === 0 ? undefined : '3 3'}
              />
              <text
                x={padLeft - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="#73726d"
              >
                {Math.round(val / 1000)}k
              </text>
            </g>
          );
        })}

        {/* Subtle Area & Lines */}
        <path d={invoicedArea} fill="url(#rampInvoicedFill)" />
        <path d={invoicedPath} fill="none" stroke="#1c1b17" strokeWidth="2" />
        <path d={collectedPath} fill="none" stroke="#e07a3c" strokeWidth="2" />

        {/* Hover Crosshair & Points */}
        {data.map((d, idx) => {
          const cx = xAt(idx);
          const cyInv = yAt(d.invoiced);
          const cyCol = yAt(d.collected);
          const isHovered = hoveredIdx === idx;
          const hitWidth = plotW / Math.max(1, data.length);

          return (
            <g
              key={d.month}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              data-testid={`trend-point-${idx}`}
              style={{ cursor: 'pointer' }}
            >
              {isHovered ? (
                <line
                  x1={cx}
                  y1={padTop}
                  x2={cx}
                  y2={padTop + plotH}
                  stroke="#cbd5e1"
                  strokeWidth="1"
                />
              ) : null}

              <circle
                cx={cx}
                cy={cyInv}
                r={isHovered ? 5 : 3.5}
                fill="#1c1b17"
                stroke="#ffffff"
                strokeWidth="1.5"
              />
              <circle
                cx={cx}
                cy={cyCol}
                r={isHovered ? 5 : 3.5}
                fill="#e07a3c"
                stroke="#ffffff"
                strokeWidth="1.5"
              />

              <text
                x={cx}
                y={height - 10}
                textAnchor="middle"
                fontSize="11"
                fill={isHovered ? '#1c1b17' : '#73726d'}
              >
                {d.month}
              </text>

              {/* Transparent wide hit target */}
              <rect
                x={cx - hitWidth / 2}
                y={padTop}
                width={hitWidth}
                height={plotH + 24}
                fill="transparent"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/* ==========================================================================
   Payments by Method Donut + Bar Breakdown
   ========================================================================== */

interface MethodSlice {
  method: PaymentMethod;
  amount: string;
  count: number;
}

interface PaymentsByMethodChartProps {
  items: MethodSlice[];
  currency: string;
}

const METHOD_PALETTE: Record<PaymentMethod, { label: string; color: string }> = {
  card: { label: 'Corporate Card', color: '#1c1b17' },
  bank_transfer: { label: 'Bank Transfer', color: '#e07a3c' },
  upi: { label: 'UPI Instant', color: '#2563eb' },
  cheque: { label: 'Cheque Clearing', color: '#ca8a04' },
  cash: { label: 'Cash Receipt', color: '#15803d' },
  other: { label: 'Other Method', color: '#64748b' },
};

export const PaymentsByMethodChart: React.FC<PaymentsByMethodChartProps> = ({
  items,
  currency,
}) => {
  const [hoveredMethod, setHoveredMethod] = useState<PaymentMethod | null>(null);

  const positiveItems = items.filter((item) => parseMoney(item.amount) > 0);
  const grandTotal = positiveItems.reduce((acc, item) => acc + parseMoney(item.amount), 0);

  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let cumulativeFraction = 0;

  const hoveredSlice = positiveItems.find((i) => i.method === hoveredMethod) ?? null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '150px minmax(0, 1fr)',
        gap: 20,
        alignItems: 'center',
      }}
    >
      {/* SVG Donut Ring */}
      <div style={{ position: 'relative', width: 140, height: 140, margin: '0 auto' }}>
        <svg viewBox="0 0 140 140" role="img" aria-label="Payments by method donut chart">
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke="#eae8e3"
            strokeWidth="16"
          />
          {grandTotal > 0 &&
            positiveItems.map((slice) => {
              const val = parseMoney(slice.amount);
              const fraction = val / grandTotal;
              const dashLength = fraction * circumference;
              const dashOffset = -cumulativeFraction * circumference;
              cumulativeFraction += fraction;
              const meta = METHOD_PALETTE[slice.method];
              const isHighlighted = hoveredMethod === slice.method;

              return (
                <circle
                  key={slice.method}
                  cx="70"
                  cy="70"
                  r={radius}
                  fill="none"
                  stroke={meta.color}
                  strokeWidth={isHighlighted ? '19' : '16'}
                  strokeDasharray={`${dashLength} ${circumference - dashLength}`}
                  strokeDashoffset={dashOffset}
                  transform="rotate(-90 70 70)"
                  onMouseEnter={() => setHoveredMethod(slice.method)}
                  onMouseLeave={() => setHoveredMethod(null)}
                  style={{ cursor: 'pointer', transition: 'stroke-width 0.15s ease' }}
                />
              );
            })}
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            textAlign: 'center',
            padding: 16,
          }}
        >
          <span className="eyebrow-cap" style={{ fontSize: 9 }}>
            {hoveredSlice ? METHOD_PALETTE[hoveredSlice.method].label : 'Methods'}
          </span>
          <span className="type-body-sm cell-numeric" style={{ fontSize: 12 }}>
            {hoveredSlice
              ? `${Math.round((parseMoney(hoveredSlice.amount) / Math.max(1, grandTotal)) * 100)}%`
              : `${positiveItems.length} active`}
          </span>
        </div>
      </div>

      {/* Interactive Method Bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.length === 0 ? (
          <span className="type-caption">No settlements recorded in selected window.</span>
        ) : (
          items.map((slice) => {
            const meta = METHOD_PALETTE[slice.method];
            const val = parseMoney(slice.amount);
            const share = grandTotal > 0 ? Math.round((val / grandTotal) * 100) : 0;
            const isHovered = hoveredMethod === slice.method;

            return (
              <div
                key={slice.method}
                onMouseEnter={() => setHoveredMethod(slice.method)}
                onMouseLeave={() => setHoveredMethod(null)}
                data-testid={`payment-method-${slice.method}`}
                style={{
                  padding: '6px 8px',
                  borderRadius: 'var(--rounded-md)',
                  backgroundColor: isHovered ? 'var(--color-canvas)' : 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span className="type-body-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: meta.color,
                      }}
                    />
                    {meta.label}
                    <span className="type-caption">({slice.count})</span>
                  </span>
                  <span className="type-body-sm cell-numeric">
                    {formatMoney(slice.amount, currency)} ({share}%)
                  </span>
                </div>
                <div
                  style={{
                    width: '100%',
                    height: 5,
                    borderRadius: 9999,
                    backgroundColor: 'var(--color-canvas-sand)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${share}%`,
                      height: '100%',
                      borderRadius: 9999,
                      backgroundColor: meta.color,
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

/* ==========================================================================
   Aging Buckets Visualization (0-30, 31-60, 61-90, 90+ days)
   ========================================================================== */

interface AgingBucketsChartProps {
  buckets: AgingBucketSummary[];
  currency: string;
  onSelectBucket?: () => void;
}

export const AgingBucketsChart: React.FC<AgingBucketsChartProps> = ({
  buckets,
  currency,
  onSelectBucket,
}) => {
  const [hoveredBucket, setHoveredBucket] = useState<string | null>(null);
  const maxAmt = Math.max(1, ...buckets.map((b) => parseMoney(b.amount)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {buckets.map((b) => {
        const val = parseMoney(b.amount);
        const pct = val > 0 ? Math.max(6, Math.round((val / maxAmt) * 100)) : 0;
        const isHovered = hoveredBucket === b.bucket;

        return (
          <div
            key={b.bucket}
            onMouseEnter={() => setHoveredBucket(b.bucket)}
            onMouseLeave={() => setHoveredBucket(null)}
            onClick={onSelectBucket}
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--rounded-md)',
              backgroundColor: isHovered ? 'var(--color-canvas)' : 'transparent',
              border: `1px solid ${isHovered ? 'var(--color-hairline-strong)' : 'transparent'}`,
              cursor: onSelectBucket ? 'pointer' : 'default',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="type-body-sm">
                {b.bucket}{' '}
                <span className="type-caption">
                  · {b.count} {b.count === 1 ? 'invoice' : 'invoices'}
                </span>
              </span>
              <span
                className="type-body-sm cell-numeric"
                style={{ color: val > 0 ? 'var(--chip-overdue-text)' : 'var(--color-ink-mute-1)' }}
              >
                {formatMoney(b.amount, currency)}
              </span>
            </div>

            <div
              style={{
                width: '100%',
                height: 7,
                borderRadius: 9999,
                backgroundColor: 'var(--color-canvas-sand)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  borderRadius: 9999,
                  backgroundColor:
                    b.bucket === '90+ days' || b.bucket === '61-90 days'
                      ? 'var(--chip-overdue-text)'
                      : 'var(--color-accent-blaze)',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

