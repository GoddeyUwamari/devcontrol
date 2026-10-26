/**
 * Shared recharts text styles for app charts (typography plan §4.1, D4).
 * SVG text can't use the text-* role classes, so axis ticks and in-chart labels take these values: the label
 * role's size (12 px) in ink-muted (slate-600, #475569), which passes AA on white and the 50 tints. Recharts
 * otherwise paints tick text in the axis stroke colour (gray-400), which does not.
 */
export const CHART_TICK = { fontSize: 12, fill: '#475569' } as const

/**
 * Recharts tooltip boxes (`<Tooltip {...CHART_TOOLTIP} />`): the box the Costs and Forecast charts already drew, with
 * its text on the meta role (13 px, like components/ui/tooltip) and the heading in ink (slate-900) at 600. Item rows
 * keep recharts' series colours.
 */
export const CHART_TOOLTIP = {
  contentStyle: {
    background: '#fff',
    border: '1px solid #E2E8F0',
    borderRadius: '10px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    padding: '10px 14px',
    fontSize: 13,
    lineHeight: '18px',
  },
  labelStyle: { fontWeight: 600, color: '#0F172A', marginBottom: '4px' },
} as const
