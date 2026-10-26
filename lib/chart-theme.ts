/**
 * Shared recharts text styles for app charts (typography plan §4.1, D4).
 * SVG text can't use the text-* role classes, so axis ticks and in-chart labels take these values: the label
 * role's size (12 px) in ink-muted (slate-600, #475569), which passes AA on white and the 50 tints. Recharts
 * otherwise paints tick text in the axis stroke colour (gray-400), which does not.
 */
export const CHART_TICK = { fontSize: 12, fill: '#475569' } as const
