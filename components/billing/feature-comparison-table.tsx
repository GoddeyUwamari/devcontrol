'use client';

/**
 * The pricing page's plan comparison: every catalog feature
 * (lib/plan/plan-catalog.ts), grouped as on the Pricing Mock. A feature
 * that isn't built shows "Soon" in its plans, never a check mark.
 */
import React from 'react';
import { Check, X, HelpCircle } from 'lucide-react';
import { PLANS, comparisonGroups, includes, priceLabel, type TableRow } from '@/lib/plan/plan-catalog';
import type { Tier } from '@/lib/plan/plan-names';
import { FeatureBadge } from '@/components/billing/feature-line';
import { TrialLine } from '@/components/billing/trial-line';

function Mark({ included, soon }: { included: boolean; soon: boolean }) {
  if (included && soon) {
    return <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280' }}>Soon</span>;
  }
  return included ? (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Check style={{ width: '16px', height: '16px', color: '#16a34a' }} />
    </div>
  ) : (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <X style={{ width: '16px', height: '16px', color: '#d1d5db' }} />
    </div>
  );
}

function Value({ value }: { value: string }) {
  return <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#374151' }}>{value}</span>;
}

function RowName({ row }: { row: TableRow }) {
  const isKey = row.kind === 'feature' && !!row.feature.key;
  const label = row.kind === 'feature' ? row.feature.label : row.row.label;
  const tooltip = row.kind === 'value' ? row.row.tooltip : undefined;
  const badge = row.kind === 'feature' ? row.feature.badge : undefined;
  const nameContent = (
    <span style={{
      fontSize: '0.875rem',
      fontWeight: isKey ? 600 : 400,
      color: '#374151',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      flexWrap: 'wrap',
    }}>
      <span data-row-label>{label}</span>
      {badge && <FeatureBadge badge={badge} />}
      {isKey && (
        <span style={{
          background: 'rgba(124,58,237,0.08)',
          color: '#7c3aed',
          borderRadius: '4px',
          padding: '1px 6px',
          fontSize: '0.65rem',
          fontWeight: 700,
        }}>
          Key
        </span>
      )}
    </span>
  );

  if (tooltip) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} title={tooltip}>
        {nameContent}
        <HelpCircle style={{ width: '14px', height: '14px', color: '#9ca3af', flexShrink: 0 }} />
      </div>
    );
  }

  return nameContent;
}

function Cell({ row, tier }: { row: TableRow; tier: Tier }) {
  if (row.kind === 'value') return <Value value={row.row.values[tier]} />;
  const f = row.feature;
  return <Mark included={includes(tier, f)} soon={f.status === 'coming_soon'} />;
}

const cellBase: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid #f3f4f6',
  fontSize: '0.875rem',
};

const proColStyle: React.CSSProperties = {
  background: 'rgba(124,58,237,0.04)',
  borderLeft: '1px solid rgba(124,58,237,0.15)',
  borderRight: '1px solid rgba(124,58,237,0.15)',
};

export function FeatureComparisonTable() {
  const groups = comparisonGroups();

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Table */}
      <div style={{
        background: '#fff',
        border: '1.5px solid #e5e7eb',
        borderRadius: '16px',
        overflow: 'hidden',
        width: '100%',
      }}>
        <p className="sm:hidden text-xs text-gray-400 text-center py-2 border-b border-gray-100">
          ← Scroll to see all plans →
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: '800px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ ...cellBase, width: '280px', textAlign: 'left', fontWeight: 600, color: '#0f172a', position: 'sticky', left: 0, background: '#f9fafb', zIndex: 10 }}>
                  Feature
                </th>
                {PLANS.map((p) => (
                  <th
                    key={p.tier}
                    data-plan={p.tier}
                    style={{
                      ...cellBase,
                      ...(p.popular ? { ...proColStyle, borderTop: '2px solid #7c3aed' } : {}),
                      width: p.tier === 'pro' || p.tier === 'enterprise' ? '140px' : '120px',
                      textAlign: 'center',
                      fontWeight: 600,
                      color: '#0f172a',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      {p.name}
                      {p.popular && (
                        <span style={{
                          background: 'rgba(124,58,237,0.1)', color: '#7c3aed',
                          borderRadius: '100px', padding: '1px 8px',
                          fontSize: '0.65rem', fontWeight: 700,
                        }}>Popular</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 400, color: '#6b7280', marginTop: '2px' }}>
                      {p.monthly === null ? priceLabel(p.tier, 'monthly') : `${priceLabel(p.tier, 'monthly')}/mo`}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <React.Fragment key={group.id}>
                  <tr style={{ background: '#f9fafb' }}>
                    <td colSpan={5} style={{ ...cellBase, fontWeight: 700, fontSize: '0.8rem', color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.08em', position: 'sticky', left: 0, background: '#f9fafb', zIndex: 10 }}>
                      {group.label}
                    </td>
                  </tr>
                  {group.rows.map((row) => {
                    const id = row.kind === 'feature' ? row.feature.id : row.row.id;
                    const isKey = row.kind === 'feature' && !!row.feature.key;
                    return (
                      <tr key={id} data-row={id} style={{ background: isKey ? 'rgba(124,58,237,0.02)' : '#fff' }}>
                        <td style={{ ...cellBase, position: 'sticky', left: 0, background: isKey ? 'rgba(124,58,237,0.02)' : '#fff', zIndex: 10 }}>
                          <RowName row={row} />
                        </td>
                        {PLANS.map((p) => (
                          <td key={p.tier} style={{ ...cellBase, ...(p.popular ? proColStyle : {}), textAlign: 'center' }}>
                            <Cell row={row} tier={p.tier} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Note */}
      <div style={{ textAlign: 'center' }}>
        <TrialLine
          variant="table"
          style={{ display: 'block', fontSize: '0.875rem', color: '#374151', marginBottom: '4px' }}
        />
        <p style={{ fontSize: '0.78rem', color: '#6b7280' }}>
          Need a custom plan?{' '}
          <a href="/contact" style={{ color: '#7c3aed', textDecoration: 'underline' }}>
            Talk to us
          </a>
        </p>
      </div>

    </div>
  );
}
