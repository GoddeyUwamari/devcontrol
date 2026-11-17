/**
 * The attribute that marks an element the floating "Live updates" pill
 * (components/ConnectionIndicator.tsx) must never sit on top of, such as the
 * Dashboard cost trend legend (trend-lag round 2: on a phone the pill covered
 * it). While the pill's box overlaps a marked element it fades out; it comes
 * back as soon as the element has scrolled clear.
 */
export const KEEP_CLEAR_OF_FLOATING = 'data-keep-clear-of-floating'

type Box = { left: number; right: number; top: number; bottom: number }

/** True when the two boxes share any area (touching edges do not count). */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/** True when `pill` overlaps any element marked KEEP_CLEAR_OF_FLOATING in `root`. */
export function coversKeepClear(pill: Box, root: ParentNode = document): boolean {
  return [...root.querySelectorAll(`[${KEEP_CLEAR_OF_FLOATING}]`)].some((el) => boxesOverlap(pill, el.getBoundingClientRect()))
}
