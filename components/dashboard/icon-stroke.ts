/**
 * One stroke width for the Dashboard's outline category and navigation icons
 * (card header icons, posture and activity type icons, info, arrows, links).
 *
 * lucide's default is 2 on a 24-unit grid. 2.25 is slightly heavier, so these
 * outline icons sit at the same visual weight as the filled status icons
 * (components/ui/status-icon.tsx) beside them. At the common 16 px size it draws
 * 2.25 × 16/24 = 1.5 CSS px: exactly 3 device pixels on a 2× screen, so the
 * line stays crisp. 2.5 would draw 1.67 px, which blurs.
 *
 * Dashboard components only (PR-ICONS-b). Trend arrows, empty-state
 * illustrations and other pages keep lucide's default.
 */
export const DASHBOARD_ICON_STROKE = 2.25
